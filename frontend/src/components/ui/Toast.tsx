"use client";

import { useApp } from "@/lib/store";

export function Toast() {
  const { toast } = useApp();
  return (
    <div className="toast" id="toast" role="status" hidden={!toast}>
      {toast?.text}
    </div>
  );
}
