// Demo model catalog for the composer's model chip — replaced by the
// provider-preferences API (available models per provider) when it lands.

export interface DemoModelOption {
  id: string;
  label: string;
}

export const demoModels: DemoModelOption[] = [
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

export const DEFAULT_DEMO_MODEL_ID = "claude-opus-4-8";
