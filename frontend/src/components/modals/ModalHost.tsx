"use client";

import { useEffect, useRef } from "react";
import { restoreModalFocus, useApp, type ModalState } from "@/lib/store";
import { AddCarModal } from "./AddCarModal";
import { DeleteCarModal } from "./DeleteCarModal";
import { LoginModal } from "./LoginModal";
import { NewRequestModal } from "./NewRequestModal";
import { RegisterModal } from "./RegisterModal";

function modalKey(m: ModalState): string {
  return JSON.stringify(m);
}

function Active({ modal }: { modal: ModalState }) {
  switch (modal.kind) {
    case "login":
      return <LoginModal staff={modal.staff} />;
    case "register":
      return <RegisterModal type={modal.type} />;
    case "newReq":
      return <NewRequestModal />;
    case "addCar":
      return <AddCarModal />;
    case "delCar":
      return <DeleteCarModal carId={modal.carId} />;
  }
}

export function ModalHost() {
  const { modal } = useApp();
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !modal) restoreModalFocus();
    wasOpen.current = !!modal;
  }, [modal]);
  return <div id="modalRoot">{modal && <Active key={modalKey(modal)} modal={modal} />}</div>;
}
