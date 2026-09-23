export type Profile = "business" | "team";

export type Draft = {
  title: string;
  description: string;
  target: string;
  desiredResult: string;
  acceptanceCriteria: string;
  scope: string;
  resources: string;
  constraints: string;
};

export type Analysis = {
  questions: string[];
  suggestions: string[];
  mode: "openai" | "mock";
};

export const emptyDraft: Draft = {
  title: "",
  description: "",
  target: "",
  desiredResult: "",
  acceptanceCriteria: "",
  scope: "",
  resources: "",
  constraints: ""
};