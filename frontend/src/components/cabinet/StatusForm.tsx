"use client";

import { useState, type FormEvent } from "react";
import { Chip } from "@/components/ui/Chip";
import { Field, fieldValue, useForm } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Progress } from "@/components/ui/Progress";
import { FULL, KIND, KIND_WORD, SHORT } from "@/lib/constants";
import { saveCarStatus, setUi, toast, useApp } from "@/lib/store";
import type { Attachment, Car } from "@/lib/types";

const STEPS = FULL.map((n, i) => ({ v: i + 1, l: i + 1 + ". " + n }));

const UPLOAD_NAMES = {
  photo: (n: number) => "IMG_" + (2040 + n) + ".jpg",
  file: (n: number) => "Документ_" + (n + 1) + ".pdf",
  video: (n: number) => "VID_" + (310 + n) + ".mp4",
};

export function StatusForm({ car }: { car: Car }) {
  const { edit } = useApp();
  const form = useForm();
  const [dropErr, setDropErr] = useState<string | null>(null);

  const target = edit.carId === car.id ? edit.target : Math.min(13, car.step + 1);
  const uploads = edit.carId === car.id ? edit.uploads : [];
  const nonce = edit.nonce;
  const kind = KIND[target - 1];

  const patch = (t: number, u: string[]) => setUi({ edit: { carId: car.id, target: t, uploads: u, nonce } });

  const changeTarget = (v: string) => {
    patch(parseInt(v, 10), []);
    setDropErr(null);
    form.forget(["fNum"]);
  };

  const addUpload = () => {
    if (kind === "none" || kind === "number") return;
    patch(target, [...uploads, UPLOAD_NAMES[kind](uploads.length)]);
    setDropErr(null);
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    let add: Attachment[] = [];
    if (kind === "number") {
      const n = (e.currentTarget.elements.namedItem("fNum") as HTMLInputElement).value.trim();
      if (!n) {
        form.setErr("fNum", "Укажите номер декларации");
        return;
      }
      add = [["number", "№ " + n]];
    } else if (kind !== "none") {
      if (!uploads.length) {
        setDropErr("Для этого статуса нужно " + KIND_WORD[kind]);
        return;
      }
      add = kind === "photo" ? [["photo", "Фото · " + uploads.length]] : uploads.map((u): Attachment => [kind, u]);
    }
    saveCarStatus(car.id, target, add, fieldValue(e.currentTarget, "fNote"));
    setUi({ edit: { carId: car.id, target: Math.min(13, target + 1), uploads: [], nonce: nonce + 1 } });
    toast("Статус «" + SHORT[target - 1] + "» сохранён. Клиент видит его в карточке.");
  };

  let body;
  if (kind === "number") {
    body = <Field id="fNum" label="Номер декларации" placeholder="10702030/260926/0012345" hint={form.hint("fNum")} />;
  } else if (kind === "none") {
    body = (
      <p className="foot muted" style={{ padding: "0 16px" }}>
        Для этого статуса вложение не нужно — шаг просто отметится как пройденный.
      </p>
    );
  } else {
    body = (
      <div className="stack" style={{ gap: "8px" }}>
        <span className="foot muted" style={{ padding: "0 16px" }}>
          {`Нужно ${KIND_WORD[kind]}`}
        </span>
        <button type="button" className={"drop" + (dropErr ? " err" : "")} id="drop" onClick={addUpload}>
          <Icon name="upload" />
          {`Перетащите ${KIND_WORD[kind]} или нажмите`}
        </button>
        <div className="pending" id="uploads">
          {uploads.map((u, i) => (
            <Chip key={i} file={[kind, u]} cls="acc" />
          ))}
        </div>
        <span className="hint err" id="dropErr" hidden={!dropErr}>
          {dropErr}
        </span>
      </div>
    );
  }

  return (
    <form className="card panel" id="statusForm" onSubmit={submit}>
      <h2 className="title-3">Сменить статус</h2>
      <Progress step={car.step} caption={SHORT[car.step - 1]} />
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
      <button type="submit" className="btn btn-filled">
        Сохранить статус
      </button>
    </form>
  );
}
