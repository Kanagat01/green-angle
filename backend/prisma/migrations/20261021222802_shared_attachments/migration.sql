-- CreateTable
CREATE TABLE "_MessageSharedAttachments" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_MessageSharedAttachments_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_MessageSharedAttachments_B_index" ON "_MessageSharedAttachments"("B");

-- AddForeignKey
ALTER TABLE "_MessageSharedAttachments" ADD CONSTRAINT "_MessageSharedAttachments_A_fkey" FOREIGN KEY ("A") REFERENCES "Attachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MessageSharedAttachments" ADD CONSTRAINT "_MessageSharedAttachments_B_fkey" FOREIGN KEY ("B") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
