"use client";

/**
 * Phone-frame preview of a WhatsApp template message, shown beside a form while
 * "Send through WhatsApp" is ticked. Pass the rendered body (see utils/whatsappTemplatePreview)
 * and, for image-header templates, the image URL.
 */

import { ChevronLeft, Video, Phone, MoreVertical, Smile, Paperclip, Camera, Mic, CheckCheck, FileText } from "lucide-react";

interface WhatsAppPhonePreviewProps {
  body: string;
  imageUrl?: string | null;
  /** Document-header templates (e.g. the newsletter PDF): the file name shown on the attachment card. */
  documentName?: string | null;
  businessName?: string;
  /** Small caption under the phone (e.g. which template is used). */
  caption?: string;
}

export default function WhatsAppPhonePreview({
  body,
  imageUrl,
  documentName,
  businessName = "Rizones45678",
  caption,
}: WhatsAppPhonePreviewProps) {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex flex-col items-center">
      <span className="mb-3 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
        WhatsApp preview
      </span>

      <div className="w-[300px] rounded-[2.6rem] bg-slate-900 p-3 shadow-xl">
        <div className="relative flex h-[600px] flex-col overflow-hidden rounded-[2rem] bg-[#efeae2]">
          {/* Status bar */}
          <div className="relative flex items-center justify-between bg-[#075e54] px-5 pb-1 pt-2 text-[11px] font-semibold text-white">
            <span>9:41</span>
            <span className="absolute left-1/2 top-1.5 h-5 w-24 -translate-x-1/2 rounded-full bg-slate-900" />
            <span className="tracking-tight">▮▮▮</span>
          </div>

          {/* Chat header */}
          <div className="flex items-center gap-2 bg-[#075e54] px-2 pb-2.5 pt-1 text-white">
            <ChevronLeft className="h-5 w-5 shrink-0" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/rotary-wheel-gold.png" alt="" className="h-8 w-8 shrink-0 rounded-full bg-white object-contain p-0.5" />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-semibold">{businessName}</p>
              <p className="text-[11px] opacity-80">online</p>
            </div>
            <Video className="h-4 w-4 shrink-0" />
            <Phone className="h-4 w-4 shrink-0" />
            <MoreVertical className="h-4 w-4 shrink-0" />
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-2.5 py-3">
            <div className="mb-3 flex justify-center">
              <span className="rounded-md bg-white/90 px-2.5 py-0.5 text-[10px] font-medium uppercase text-slate-500 shadow-sm">
                Today
              </span>
            </div>

            <div className="max-w-[92%] rounded-lg rounded-tl-none bg-white p-1 shadow-sm">
              {imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="Header" className="mb-1 w-full rounded-md object-cover" />
              )}
              {documentName && (
                <div className="mb-1 flex items-center gap-2 rounded-md bg-slate-100 px-2 py-2">
                  <FileText className="h-6 w-6 shrink-0 text-rose-600" />
                  <span className="truncate text-[11.5px] font-medium text-slate-700">{documentName}</span>
                </div>
              )}
              <p className="whitespace-pre-wrap break-words px-1.5 pt-0.5 text-[12.5px] leading-snug text-slate-800">
                {body}
              </p>
              <div className="flex items-center justify-end gap-1 px-1.5 pb-0.5 text-[10px] text-slate-400">
                {time}
                <CheckCheck className="h-3 w-3 text-sky-500" />
              </div>
            </div>
          </div>

          {/* Input bar */}
          <div className="flex items-center gap-1.5 px-2 pb-3 pt-1.5">
            <div className="flex flex-1 items-center gap-2 rounded-full bg-white px-3 py-2 text-slate-400 shadow-sm">
              <Smile className="h-4 w-4" />
              <span className="flex-1 text-xs">Message</span>
              <Paperclip className="h-4 w-4" />
              <Camera className="h-4 w-4" />
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#00a884] text-white">
              <Mic className="h-4 w-4" />
            </div>
          </div>
        </div>
      </div>

      {caption && <p className="mt-2 max-w-[300px] text-center text-[11px] text-slate-500">{caption}</p>}
    </div>
  );
}
