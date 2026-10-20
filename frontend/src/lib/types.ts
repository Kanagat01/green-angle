export type Role = "picker" | "person" | "super";
export type OwnerType = "picker" | "person";

export type Owner = { type: OwnerType; name: string };

export type StepKind = "none" | "file" | "photo" | "video" | "number";
export type AttachmentKind = Exclude<StepKind, "none"> | "link";
export type Attachment = [AttachmentKind, string];

export type Car = {
  id: string;
  title: string;
  vin: string;
  owner: Owner;
  step: number;
  created: string;
  updated: string;
  reqId?: string;
  files: Record<number, Attachment[]>;
};

export type Message = {
  who: "client" | "manager" | "system";
  time: string;
  text: string;
  files: Attachment[];
};

export type RequestStatus = "new" | "dialog" | "approved" | "rejected";

export type Request = {
  id: string;
  seqn?: number;
  model: string;
  year: string;
  budget: string;
  comment: string;
  owner: Owner;
  status: RequestStatus;
  carId?: string;
  created: string;
  messages: Message[];
};

export type Db = { seq: number; cars: Car[]; requests: Request[] };

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";
