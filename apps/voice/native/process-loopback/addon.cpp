// Vynel process-loopback capture — the "ears" of a Windows call with NO
// virtual cable: per-process WASAPI loopback via ActivateAudioInterfaceAsync
// (AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, Windows 10 2004+).
//
// API usage follows Microsoft's ApplicationLoopback sample (MIT); the
// implementation is deliberately dependency-free — no WIL (NuGet), no WRL, no
// Media Foundation queues. One capture thread waits on the WASAPI event and
// pumps packets to JS through a non-blocking thread-safe function; a full
// queue drops the chunk (a dropped chunk is indistinguishable from the
// silence gaps this API already produces when the target app isn't playing).
//
// Format is fixed 48 kHz / stereo / float32 — AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
// makes the engine convert; the TS seam downmixes exactly like device capture.

#include <windows.h>
#include <objidl.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>

#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <thread>

#define NAPI_VERSION 8
#include <node_api.h>

namespace {

constexpr uint32_t kSampleRate = 48000;
constexpr uint16_t kChannels = 2;

struct AudioChunk {
  uint32_t sampleCount;
  float samples[1]; // over-allocated
};

// Heap-refcounted so an activation that times out can safely outlive our stack
// frame — the async operation still holds a reference until its callback runs.
struct ActivationWaiter final : IActivateAudioInterfaceCompletionHandler {
  std::atomic<ULONG> refs{1};
  HANDLE done = nullptr;
  HRESULT activateHr = E_UNEXPECTED;
  IAudioClient* client = nullptr;

  ActivationWaiter() { done = CreateEventW(nullptr, FALSE, FALSE, nullptr); }
  ~ActivationWaiter() {
    if (client != nullptr) client->Release();
    if (done != nullptr) CloseHandle(done);
  }

  IAudioClient* takeClient() {
    IAudioClient* taken = client;
    client = nullptr;
    return taken;
  }

  IFACEMETHODIMP_(ULONG) AddRef() override { return ++refs; }
  IFACEMETHODIMP_(ULONG) Release() override {
    const ULONG remaining = --refs;
    if (remaining == 0) delete this;
    return remaining;
  }
  IFACEMETHODIMP QueryInterface(REFIID riid, void** out) override {
    if (out == nullptr) return E_POINTER;
    // IAgileObject is a marker: declaring it keeps COM from trying to marshal
    // the callback across apartments (the sample uses WRL FtmBase for this).
    if (riid == __uuidof(IUnknown) || riid == __uuidof(IActivateAudioInterfaceCompletionHandler) ||
        riid == __uuidof(IAgileObject)) {
      *out = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
      AddRef();
      return S_OK;
    }
    *out = nullptr;
    return E_NOINTERFACE;
  }
  IFACEMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation* operation) override {
    HRESULT resultOfActivation = E_UNEXPECTED;
    IUnknown* unknown = nullptr;
    HRESULT hr = operation->GetActivateResult(&resultOfActivation, &unknown);
    if (SUCCEEDED(hr)) hr = resultOfActivation;
    if (SUCCEEDED(hr) && unknown != nullptr) {
      hr = unknown->QueryInterface(__uuidof(IAudioClient), reinterpret_cast<void**>(&client));
    }
    if (unknown != nullptr) unknown->Release();
    activateHr = hr;
    SetEvent(done);
    return S_OK;
  }
};

struct CaptureSession {
  DWORD processId = 0;
  bool includeProcessTree = true;
  HANDLE stopEvent = nullptr;  // manual-reset
  HANDLE readyEvent = nullptr; // start() blocks on this for a sync error report
  // Written by the worker, read by start() after readyEvent — atomic because
  // the 15s startup-timeout branch lets start() read before the worker's write
  // is ordered by the event.
  std::atomic<HRESULT> startResult{E_PENDING};
  std::atomic<const char*> failedStage{""};
  napi_threadsafe_function deliver = nullptr;
  std::thread worker;
  std::atomic<bool> stopped{false};
};

// Stops the capture thread if it's still running. The session is NOT deleted
// here — ownership belongs to the external handle's finalizer, the sole
// deleter, so a second stop() (or an abandoned handle) can never double-free.
void stopSession(CaptureSession* session) {
  if (session->stopped.exchange(true)) return;
  SetEvent(session->stopEvent);
  if (session->worker.joinable()) session->worker.join();
}

void deliverToJs(napi_env env, napi_value jsCallback, void* /*context*/, void* chunkRaw) {
  AudioChunk* chunk = static_cast<AudioChunk*>(chunkRaw);
  if (env != nullptr && jsCallback != nullptr) {
    const size_t byteLength = static_cast<size_t>(chunk->sampleCount) * sizeof(float);
    void* bytes = nullptr;
    napi_value arrayBuffer = nullptr;
    if (napi_create_arraybuffer(env, byteLength, &bytes, &arrayBuffer) == napi_ok) {
      memcpy(bytes, chunk->samples, byteLength);
      napi_value typedArray = nullptr;
      napi_value undefined = nullptr;
      if (napi_create_typedarray(env, napi_float32_array, chunk->sampleCount, arrayBuffer, 0, &typedArray) == napi_ok &&
          napi_get_undefined(env, &undefined) == napi_ok) {
        napi_call_function(env, undefined, jsCallback, 1, &typedArray, nullptr);
      }
    }
  }
  free(chunk);
}

void captureThreadMain(CaptureSession* session) {
  IAudioClient* audioClient = nullptr;
  IAudioCaptureClient* captureClient = nullptr;
  HANDLE sampleEvent = nullptr;
  const char* stage = "";
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  const bool comInitialized = SUCCEEDED(hr);
  if (!comInitialized) {
    stage = "CoInitializeEx";
  } else {
    do {
      sampleEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
      if (sampleEvent == nullptr) {
        hr = HRESULT_FROM_WIN32(GetLastError());
        stage = "CreateEvent";
        break;
      }

      AUDIOCLIENT_ACTIVATION_PARAMS activationParams = {};
      activationParams.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
      activationParams.ProcessLoopbackParams.TargetProcessId = session->processId;
      activationParams.ProcessLoopbackParams.ProcessLoopbackMode = session->includeProcessTree
          ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
          : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
      PROPVARIANT activateParams = {};
      activateParams.vt = VT_BLOB;
      activateParams.blob.cbSize = sizeof(activationParams);
      activateParams.blob.pBlobData = reinterpret_cast<BYTE*>(&activationParams);

      ActivationWaiter* waiter = new ActivationWaiter();
      IActivateAudioInterfaceAsyncOperation* asyncOperation = nullptr;
      hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient),
                                       &activateParams, waiter, &asyncOperation);
      if (FAILED(hr)) {
        stage = "ActivateAudioInterfaceAsync";
        waiter->Release();
        break;
      }
      const DWORD waited = WaitForSingleObject(waiter->done, 10'000);
      if (asyncOperation != nullptr) asyncOperation->Release();
      if (waited != WAIT_OBJECT_0) {
        hr = HRESULT_FROM_WIN32(ERROR_TIMEOUT);
        stage = "activation wait";
        waiter->Release(); // waiter stays alive for the late callback via the op's ref
        break;
      }
      hr = waiter->activateHr;
      audioClient = waiter->takeClient();
      waiter->Release();
      if (FAILED(hr) || audioClient == nullptr) {
        if (SUCCEEDED(hr)) hr = E_NOINTERFACE;
        stage = "activation result";
        break;
      }

      WAVEFORMATEX format = {};
      format.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
      format.nChannels = kChannels;
      format.nSamplesPerSec = kSampleRate;
      format.wBitsPerSample = 32;
      format.nBlockAlign = static_cast<WORD>(kChannels * sizeof(float));
      format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
      hr = audioClient->Initialize(
          AUDCLNT_SHAREMODE_SHARED,
          AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
              AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
          0, 0, &format, nullptr);
      if (FAILED(hr)) {
        stage = "Initialize";
        break;
      }
      hr = audioClient->SetEventHandle(sampleEvent);
      if (FAILED(hr)) {
        stage = "SetEventHandle";
        break;
      }
      hr = audioClient->GetService(__uuidof(IAudioCaptureClient), reinterpret_cast<void**>(&captureClient));
      if (FAILED(hr)) {
        stage = "GetService";
        break;
      }
      hr = audioClient->Start();
      if (FAILED(hr)) stage = "Start";
    } while (false);
  }

  session->failedStage.store(stage);
  session->startResult.store(hr);
  SetEvent(session->readyEvent);

  if (SUCCEEDED(hr)) {
    HANDLE waits[2] = {session->stopEvent, sampleEvent};
    for (;;) {
      const DWORD which = WaitForMultipleObjects(2, waits, FALSE, INFINITE);
      if (which != WAIT_OBJECT_0 + 1) break; // stop requested (or wait failure)
      UINT32 framesInNextPacket = 0;
      while (SUCCEEDED(captureClient->GetNextPacketSize(&framesInNextPacket)) && framesInNextPacket > 0) {
        BYTE* bytes = nullptr;
        UINT32 frames = 0;
        DWORD flags = 0;
        if (FAILED(captureClient->GetBuffer(&bytes, &frames, &flags, nullptr, nullptr))) break;
        const uint32_t sampleCount = frames * kChannels;
        AudioChunk* chunk =
            static_cast<AudioChunk*>(malloc(sizeof(AudioChunk) + static_cast<size_t>(sampleCount) * sizeof(float)));
        if (chunk != nullptr) {
          chunk->sampleCount = sampleCount;
          const size_t byteLength = static_cast<size_t>(sampleCount) * sizeof(float);
          if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0) memset(chunk->samples, 0, byteLength);
          else memcpy(chunk->samples, bytes, byteLength);
          if (napi_call_threadsafe_function(session->deliver, chunk, napi_tsfn_nonblocking) != napi_ok) {
            free(chunk); // queue full or torn down — the gap reads as silence
          }
        }
        captureClient->ReleaseBuffer(frames);
      }
    }
    audioClient->Stop();
  }

  if (captureClient != nullptr) captureClient->Release();
  if (audioClient != nullptr) audioClient->Release();
  if (sampleEvent != nullptr) CloseHandle(sampleEvent);
  if (comInitialized) CoUninitialize();
  // The capture thread is the tsfn's sole releaser — start() and stop() never
  // release it, so the ordering is deterministic on every path.
  napi_release_threadsafe_function(session->deliver, napi_tsfn_release);
}

void throwStartError(napi_env env, const CaptureSession* session) {
  const char* stage = session->failedStage.load();
  char message[160];
  snprintf(message, sizeof(message), "process loopback start failed at %s (hr=0x%08lX) — is the pid alive?",
           (stage != nullptr && stage[0] != '\0') ? stage : "startup",
           static_cast<unsigned long>(session->startResult.load()));
  napi_throw_error(env, nullptr, message);
}

void destroySession(CaptureSession* session) {
  if (session->stopEvent != nullptr) CloseHandle(session->stopEvent);
  if (session->readyEvent != nullptr) CloseHandle(session->readyEvent);
  delete session;
}

// The external handle's GC/teardown finalizer — the ONE place a session is
// deleted. Stops the thread first (no-op if stop() already did), then frees.
void finalizeSession(napi_env /*env*/, void* data, void* /*hint*/) {
  CaptureSession* session = static_cast<CaptureSession*>(data);
  stopSession(session);
  destroySession(session);
}

napi_value start(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc < 3) {
    napi_throw_error(env, nullptr, "start(processId, includeProcessTree, onAudio) expects three arguments");
    return nullptr;
  }
  uint32_t processId = 0;
  bool includeProcessTree = true;
  napi_valuetype callbackType = napi_undefined;
  if (napi_get_value_uint32(env, args[0], &processId) != napi_ok || processId == 0 ||
      napi_get_value_bool(env, args[1], &includeProcessTree) != napi_ok ||
      napi_typeof(env, args[2], &callbackType) != napi_ok || callbackType != napi_function) {
    napi_throw_error(env, nullptr, "start(processId, includeProcessTree, onAudio): pid must be a positive number and onAudio a function");
    return nullptr;
  }

  CaptureSession* session = new CaptureSession();
  session->processId = processId;
  session->includeProcessTree = includeProcessTree;
  session->stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  session->readyEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  napi_value resourceName = nullptr;
  napi_create_string_utf8(env, "vynel-process-loopback", NAPI_AUTO_LENGTH, &resourceName);
  if (session->stopEvent == nullptr || session->readyEvent == nullptr ||
      napi_create_threadsafe_function(env, args[2], nullptr, resourceName, 64, 1, nullptr, nullptr, nullptr,
                                      deliverToJs, &session->deliver) != napi_ok) {
    destroySession(session);
    napi_throw_error(env, nullptr, "process loopback start failed to allocate its delivery queue");
    return nullptr;
  }
  // The capture stream must never hold the daemon's event loop open by itself.
  napi_unref_threadsafe_function(env, session->deliver);

  session->worker = std::thread(captureThreadMain, session);
  if (WaitForSingleObject(session->readyEvent, 15'000) != WAIT_OBJECT_0) {
    session->failedStage.store("startup wait");
    session->startResult.store(HRESULT_FROM_WIN32(ERROR_TIMEOUT));
  }
  // Before the external exists there's no finalizer, so these paths own the
  // stop + delete themselves; once the external is created the finalizer does.
  if (FAILED(session->startResult.load())) {
    throwStartError(env, session);
    stopSession(session);
    destroySession(session);
    return nullptr;
  }

  napi_value external = nullptr;
  if (napi_create_external(env, session, finalizeSession, nullptr, &external) != napi_ok) {
    stopSession(session);
    destroySession(session);
    napi_throw_error(env, nullptr, "process loopback start failed to wrap its handle");
    return nullptr;
  }
  return external;
}

napi_value stop(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  void* raw = nullptr;
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc < 1 ||
      napi_get_value_external(env, args[0], &raw) != napi_ok || raw == nullptr) {
    napi_throw_error(env, nullptr, "stop(handle) expects the handle returned by start()");
    return nullptr;
  }
  // Stop-only, never delete: the session lives until its external is GC'd
  // (finalizeSession is the sole deleter), so a second stop() — or stop()
  // then GC — is safe. Idempotent via the exchange inside stopSession.
  stopSession(static_cast<CaptureSession*>(raw));
  return nullptr;
}

napi_value initModule(napi_env env, napi_value exports) {
  napi_value sampleRate = nullptr;
  napi_value channels = nullptr;
  napi_create_uint32(env, kSampleRate, &sampleRate);
  napi_create_uint32(env, kChannels, &channels);
  const napi_property_descriptor properties[] = {
      {"start", nullptr, start, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"stop", nullptr, stop, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"captureSampleRate", nullptr, nullptr, nullptr, nullptr, sampleRate, napi_default, nullptr},
      {"captureChannels", nullptr, nullptr, nullptr, nullptr, channels, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

} // namespace

NAPI_MODULE(vynel_process_loopback, initModule)
