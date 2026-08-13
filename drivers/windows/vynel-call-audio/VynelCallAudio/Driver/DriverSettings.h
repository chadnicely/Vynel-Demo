/*++

Copyright (c) Microsoft Corporation.  All rights reserved.

    THIS CODE AND INFORMATION IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY
    KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND/OR FITNESS FOR A PARTICULAR
    PURPOSE.

Module Name:

    DriverSettings.h

Abstract:

    Contains guid definitions and other definitions used by the render and capture circuits
    for this specific driver. Driver developers should replace these definitions with their
    own. 

Environment:

    Kernel mode

--*/

// Defining the component ID for the capture circuit. This ID uniquely identifies the circuit instance (vendor specific):
DEFINE_GUID(CODEC_CAPTURE_COMPONENT_GUID, 0x180f676f, 0x3883, 0x49e8, 0x81, 0x13, 0x71, 0xd2, 0x0f, 0x9e, 0x3d, 0xba);

// Defines a custom name for the capture circuit bridge pin:
DEFINE_GUID(MIC_CUSTOM_NAME, 0xb485172d, 0x5025, 0x4ff6, 0xa9, 0x4a, 0xaa, 0xe1, 0x51, 0x0b, 0xf0, 0x88);

// Defining the component ID for the render circuit. This ID uniquely identifies the circuit instance (vendor specific):
DEFINE_GUID(CODEC_RENDER_COMPONENT_GUID, 0x6d0fd0ac, 0x937f, 0x4f3d, 0xba, 0x31, 0x38, 0x67, 0xc7, 0xf1, 0x8e, 0x3b);

// This is always the definition for the system container guid:
DEFINE_GUID(SYSTEM_CONTAINER_GUID, 0x00000000, 0x0000, 0x0000, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF);

// Driver developers should update this guid if the container is a device rather than a
// system. Otherwise, this GUID should stay the same:
DEFINE_GUID(DEVICE_CONTAINER_GUID, 0x00000000, 0x0000, 0x0000, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF);

// AudioCodec driver tag:
#define DRIVER_TAG (ULONG) 'uaCV'

// The idle timeout in msec for power policy structure:
#define IDLE_TIMEOUT_MSEC (ULONG) 10000

// The WPP control GUID defined in Trace.h should also be updated to be unique.

// This string must match the string defined in AudioCodec.inf for the microphone name:
DECLARE_CONST_UNICODE_STRING(captureCircuitName, L"Microphone0");

// This string must match the string defined in AudioCodec.inf for the speaker name:
DECLARE_CONST_UNICODE_STRING(renderCircuitName, L"Speaker0");
