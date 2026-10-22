"use client";

import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { Field, fieldValue, useForm } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Progress } from "@/components/ui/Progress";
import { ApiError } from "@/lib/api/client";
import { useChangeStatus, type VehicleCard } from "@/lib/api/queries";
import { ACCEPT, uploadFile, type UploadKind } from "@/lib/api/uploads";
import { FULL, KIND, KIND_WORD, SHORT } from "@/lib/constants";
import { toast } from "@/lib/store";
import type { StepKind } from "@/lib/types";

const STEPS = FULL.map((n, i) => ({ v: i + 1, l: i + 1 + ". " + n }));

const UPLOAD_KIND: Partial<Record<StepKind, UploadKind>> = { photo: "PHOTO", file: "FILE", video: "VIDEO" };

type Upload = { id: number; name: string; state: "uploading" | "done"; key?: string };

export function StatusForm({ car }: { car: VehicleCard }) {
  const form = useForm();
  const change = useChangeStatus(car.id);
  const [target, setTarget] = useState(Math.min(13, car.currentStep + 1));
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dropErr, setDropErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const kind = KIND[target - 1];
  const uploadKind = UPLOAD_KIND[kind];
  // Откат назад вложение не требует; вперёд и «повтор» шага — требует то, что ждёт шаг
  const needsEvidence = target >= car.currentStep;

  const changeTarget = (v: string) => {
    setTarget(parseInt(v, 10));
    setUploads([]);
    setDropErr(null);
    form.forget(["fNum"]);
  };

  const addFiles = (files: File[]) => {
    if (!uploadKind) return;
    setDropErr(null);
    for (const file of files) {
      const id = ++seq.current;
      setUploads((u) => [...u, { id, name: file.name, state: "uploading" }]);
      uploadFile(file, uploadKind)
        .then((done) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, state: "done", key: done.key } : x))))
        .catch((err: unknown) => {
          setUploads((u) => u.filter((x) => x.id !== id));
          setDropErr(err instanceof ApiError ? err.message : "Не удалось загрузить файл.");
        });
    }
  };

  const onDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    addFiles(Array.from(e.dataTransfer.files));
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const body: Parameters<typeof change.mutateAsync>[0] = { step: target };
    if (kind === "number") {
      const n = fieldValue(el, "fNum");
      if (!n && needsEvidence) {
        form.setErr("fNum", "Укажите номер декларации");
        return;
      }
      if (n) body.declarationNumber = n;
    } else if (uploadKind) {
      if (uploads.some((u) => u.state === "uploading")) {
        setDropErr("Дождитесь окончания загрузки");
        return;
      }
      if (!uploads.length && needsEvidence) {
        setDropErr("Для этого статуса нужно " + KIND_WORD[kind as Exclude<StepKind, "none">]);
        return;
      }
      body.attachments = uploads.map((u) => ({ key: u.key!, kind: uploadKind }));
    }
    const note = fieldValue(el, "fNote");
    if (note) body.comment = note;

    try {
      await change.mutateAsync(body);
      setUploads([]);
      setTarget(Math.min(13, target + 1));
      form.forget(["fNum", "fNote"]);
      el.reset();
      toast("Статус «" + SHORT[target - 1] + "» сохранён. Клиент видит его в карточке.");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Не удалось сохранить статус.";
      if (kind === "number" && err instanceof ApiError && err.status === 400) form.setErr("fNum", message);
      else if (uploadKind && err instanceof ApiError && err.status === 400) setDropErr(message);
      else toast(message);
    }
  };

  let body;
  if (kind === "number") {
    body = <Field id="fNum" label="Номер декларации" placeholder="10702030/260926/0012345" hint={form.hint("fNum")} />;
  } else if (!uploadKind) {
    body = (
      <p className="foot muted" style={{ padding: "0 16px" }}>
        Для этого статуса вложение не нужно — шаг просто отметится как пройденный.
      </p>
    );
  } else {
    const word = KIND_WORD[kind as Exclude<StepKind, "none">];
    body = (
      <div className="stack" style={{ gap: "8px" }}>
        <span className="foot muted" style={{ padding: "0 16px" }}>
          {`Нужно ${word}`}
        </span>
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          accept={ACCEPT[uploadKind]}
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className={"drop" + (dropErr ? " err" : "")}
          id="drop"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <Icon name="upload" />
          {`Перетащите ${word} или нажмите`}
        </button>
        <div className="pending" id="uploads">
          {uploads.map((u) => (
            <span className="chip acc" key={u.id}>
              <Icon name={kind as "photo" | "file" | "video"} />
              {u.state === "uploading" ? `${u.name} · загрузка…` : u.name}
              <button
                type="button"
                aria-label="Убрать вложение"
                style={{ border: 0, background: "none", color: "inherit", cursor: "pointer", padding: "0 0 0 4px", display: "grid" }}
                onClick={() => setUploads((list) => list.filter((x) => x.id !== u.id))}
              >
                <Icon name="close" />
              </button>
            </span>
          ))}
        </div>
        <span className="hint err" id="dropErr" hidden={!dropErr}>
          {dropErr}
        </span>
      </div>
    );
  }

  return (
    <form className="card panel" id="statusForm" noValidate onSubmit={(e) => void submit(e)}>
      <h2 className="title-3">Сменить статус</h2>
      <Progress step={car.currentStep} caption={SHORT[car.currentStep - 1]} />
      <Field
        id="fTarget"
        label="Новый статус"
        options={STEPS}
        control={{ value: String(target), onChange: changeTarget }}
        hint={form.hint("fTarget")}
      />
      {body}
      <Field
        id="fNote"
        label="Комментарий для клиента"
        multiline
        placeholder="Необязательно. Уйдёт в диалог по заявке, если он есть."
        hint={form.hint("fNote")}
      />
      <button type="submit" className="btn btn-filled" disabled={change.isPending}>
        Сохранить статус
      </button>
    </form>
  );
}
