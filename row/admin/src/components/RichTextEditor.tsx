"use client";

/**
 * Shared rich-text (WYSIWYG) editor built on react-quill-new.
 * Full toolbar: font family + size, bold/italic/underline/strike, text colour +
 * highlight, headings, ordered/bullet lists, text alignment, link, image and
 * clear-formatting. Emits HTML via onChange — safe to store and to send straight
 * to Brevo's htmlContent (mass-email body renders as HTML).
 *
 * Images:
 *   - The toolbar "image" button UPLOADS the picture to the server and inserts an
 *     absolute https URL (NOT an inline base64 data-URI). Email clients strip
 *     base64 images, so this is what makes the picture actually appear in the
 *     received mail. Big pictures are downscaled on the client first (max width
 *     ~1000px) so the email stays light.
 *   - Click an image to get drag handles (corners + sides) to resize it. The width
 *     is stored on the <img> (whitelisted format below) so it survives save/send.
 */

import dynamic from "next/dynamic";
import { useRef, useCallback, useEffect } from "react";
import "react-quill-new/dist/quill.snow.css";
import { uploadMassEmailImage } from "@/services/api";

// Load react-quill-new AND register a resizable image format on the same Quill
// instance it uses, so width/height/style survive re-render and serialization.
const ReactQuill = dynamic(
  async () => {
    const { default: RQ } = await import("react-quill-new");
    const Quill = (await import("quill")).default;
    const BaseImage: any = Quill.import("formats/image");
    const ATTRS = ["alt", "height", "width", "style"];
    if (BaseImage && !(BaseImage as any).__resizablePatched) {
      class ResizableImage extends BaseImage {
        static formats(domNode: HTMLElement) {
          return ATTRS.reduce((f: Record<string, string>, a) => {
            if (domNode.hasAttribute(a)) f[a] = domNode.getAttribute(a) as string;
            return f;
          }, {});
        }
        format(name: string, value: string) {
          if (ATTRS.indexOf(name) > -1) {
            if (value) (this as any).domNode.setAttribute(name, value);
            else (this as any).domNode.removeAttribute(name);
          } else {
            super.format(name, value);
          }
        }
      }
      (ResizableImage as any).__resizablePatched = true;
      Quill.register(ResizableImage, true);
    }
    return RQ;
  },
  { ssr: false }
);

const MAX_IMAGE_WIDTH = 1000; // downscale wider images before upload

// Downscale a picked image via canvas so big photos don't bloat the email.
// GIFs are left untouched (canvas would drop animation).
async function downscaleImage(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file;
  try {
    const dataUrl: string = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const img: HTMLImageElement = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = dataUrl;
    });
    if (img.width <= MAX_IMAGE_WIDTH) return file;
    const scale = MAX_IMAGE_WIDTH / img.width;
    const canvas = document.createElement("canvas");
    canvas.width = MAX_IMAGE_WIDTH;
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, type, 0.85));
    return blob || file;
  } catch {
    return file; // fall back to original on any decode error
  }
}

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** editor body height in px (toolbar sits above); default 250 */
  height?: number;
}

export default function RichTextEditor({ value, onChange, placeholder, height = 250 }: RichTextEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Resolve the live Quill instance from the DOM (robust across the dynamic import).
  const getQuill = useCallback(async () => {
    const el = containerRef.current?.querySelector(".ql-container");
    if (!el) return null;
    const Quill = (await import("quill")).default;
    return (Quill as any).find(el);
  }, []);

  const imageHandler = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const blob = await downscaleImage(file);
        const { url } = await uploadMassEmailImage(blob, file.name);
        const quill = await getQuill();
        if (!quill) return;
        const range = quill.getSelection(true);
        const index = range ? range.index : quill.getLength();
        quill.insertEmbed(index, "image", url, "user");
        quill.setSelection(index + 1, 0);
      } catch {
        alert("Image upload failed. Please try a smaller image or check your connection.");
      }
    };
    input.click();
  }, [getQuill]);

  // Per-instance module config (kept in a ref so the toolbar isn't rebuilt on
  // every render — a fresh object each render duplicates Quill's toolbar).
  const modules = useRef({
    toolbar: {
      container: [
        [{ font: [] }, { size: [] }],
        ["bold", "italic", "underline", "strike"],
        [{ color: [] }, { background: [] }],
        [{ header: [1, 2, 3, false] }],
        [{ list: "ordered" }, { list: "bullet" }],
        [{ align: [] }],
        ["link", "image"],
        ["clean"],
      ],
      handlers: { image: imageHandler },
    },
  }).current;

  // ── Drag-to-resize overlay ────────────────────────────────────────────────
  // Click an image → 8 handles appear; drag any handle to scale (aspect kept).
  // Width is written to the <img> and synced back through onChange on drag end.
  useEffect(() => {
    const wrap = containerRef.current;
    if (!wrap) return;
    let editor: HTMLElement | null = null;
    let overlay: HTMLDivElement | null = null;
    let target: HTMLImageElement | null = null;
    let raf = 0;

    const HANDLES = ["nw", "ne", "sw", "se", "n", "s", "e", "w"];
    const cursorFor: Record<string, string> = {
      nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
      n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
    };

    const findEditor = () => {
      if (!editor) editor = wrap.querySelector(".ql-editor");
      return editor;
    };

    const position = () => {
      if (!overlay || !target) return;
      const ir = target.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      overlay.style.left = ir.left - wr.left + "px";
      overlay.style.top = ir.top - wr.top + "px";
      overlay.style.width = ir.width + "px";
      overlay.style.height = ir.height + "px";
    };

    const hide = () => {
      if (overlay) { overlay.remove(); overlay = null; }
      target = null;
    };

    const show = (img: HTMLImageElement) => {
      hide();
      target = img;
      overlay = document.createElement("div");
      overlay.style.cssText =
        "position:absolute;box-sizing:border-box;border:1.5px solid #17458f;" +
        "pointer-events:none;z-index:20;";
      HANDLES.forEach((h) => {
        const dot = document.createElement("div");
        const pos: Record<string, string> = {
          nw: "top:-5px;left:-5px;", ne: "top:-5px;right:-5px;",
          sw: "bottom:-5px;left:-5px;", se: "bottom:-5px;right:-5px;",
          n: "top:-5px;left:50%;transform:translateX(-50%);",
          s: "bottom:-5px;left:50%;transform:translateX(-50%);",
          e: "right:-5px;top:50%;transform:translateY(-50%);",
          w: "left:-5px;top:50%;transform:translateY(-50%);",
        };
        dot.style.cssText =
          "position:absolute;width:10px;height:10px;background:#17458f;border:1px solid #fcfdfe;" +
          "border-radius:2px;pointer-events:auto;cursor:" + cursorFor[h] + ";" + pos[h];
        dot.addEventListener("mousedown", (e) => startDrag(e, h));
        overlay!.appendChild(dot);
      });
      // Align toolbar (Left / Center / Right) — the email-safe way to reposition.
      const bar = document.createElement("div");
      bar.style.cssText =
        "position:absolute;top:-32px;left:0;display:flex;gap:3px;background:#17458f;" +
        "padding:3px;border-radius:6px;pointer-events:auto;z-index:21;box-shadow:0 1px 4px rgba(0,0,0,.25);";
      ([["left", "Left"], ["center", "Center"], ["right", "Right"]] as const).forEach(([al, label]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.style.cssText =
          "font-size:11px;font-weight:600;color:#fcfdfe;background:transparent;border:0;" +
          "padding:2px 7px;border-radius:4px;cursor:pointer;";
        b.addEventListener("mouseenter", () => (b.style.background = "rgba(255,255,255,.18)"));
        b.addEventListener("mouseleave", () => (b.style.background = "transparent"));
        b.addEventListener("mousedown", (ev) => { ev.preventDefault(); applyAlign(al); });
        bar.appendChild(b);
      });
      overlay.appendChild(bar);
      wrap.appendChild(overlay);
      position();
    };

    const applyAlign = async (al: "left" | "center" | "right") => {
      if (!target) return;
      target.style.float = al === "left" ? "left" : al === "right" ? "right" : "none";
      target.style.display = al === "center" ? "block" : "";
      target.style.margin =
        al === "center" ? "0 auto" : al === "left" ? "0 10px 10px 0" : al === "right" ? "0 0 10px 10px" : "";
      const quill = await getQuill();
      if (quill) onChangeRef.current(quill.root.innerHTML);
      requestAnimationFrame(position);
    };

    let startX = 0, startW = 0, ratio = 1, sign = 1;
    const startDrag = (e: MouseEvent, handle: string) => {
      if (!target) return;
      e.preventDefault();
      const r = target.getBoundingClientRect();
      startX = e.clientX;
      startW = r.width;
      ratio = r.height / r.width || 1;
      // right-side handles grow when dragging right; left-side handles grow when dragging left
      sign = handle.indexOf("w") > -1 ? -1 : 1;
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };
    const onMove = (e: MouseEvent) => {
      if (!target) return;
      const maxW = (findEditor()?.clientWidth || 800) - 8;
      let w = Math.round(startW + sign * (e.clientX - startX));
      w = Math.max(40, Math.min(w, maxW));
      target.style.width = w + "px";
      target.style.height = Math.round(w * ratio) + "px";
      target.setAttribute("width", String(w));
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(position);
    };
    const onUp = async () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (!target) return;
      // remove the fixed pixel height so aspect stays natural; keep width
      target.style.height = "";
      target.removeAttribute("height");
      const quill = await getQuill();
      if (quill) onChangeRef.current(quill.root.innerHTML);
      position();
    };

    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t && t.tagName === "IMG" && findEditor()?.contains(t)) {
        show(t as HTMLImageElement);
      } else if (!overlay || !overlay.contains(t)) {
        hide();
      }
    };

    // ── Drag the image body to a NEW spot in the text ─────────────────────────
    let moveImg: HTMLImageElement | null = null;
    let mStartX = 0, mStartY = 0, moving = false;
    let caret: HTMLDivElement | null = null;

    const showCaretAt = (x: number, y: number) => {
      const ed = findEditor();
      if (!ed) return;
      const r = (document as any).caretRangeFromPoint?.(x, y) as Range | undefined;
      if (!r) return;
      const rect = r.getClientRects()[0] || r.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      if (!caret) {
        caret = document.createElement("div");
        caret.style.cssText = "position:absolute;width:2px;background:#F7A81B;z-index:22;pointer-events:none;";
        wrap.appendChild(caret);
      }
      caret.style.left = rect.left - wr.left + "px";
      caret.style.top = rect.top - wr.top + "px";
      caret.style.height = (rect.height || 18) + "px";
    };
    const removeCaret = () => { if (caret) { caret.remove(); caret = null; } };

    const onImgMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!(t && t.tagName === "IMG" && findEditor()?.contains(t))) return;
      moveImg = t as HTMLImageElement;
      mStartX = e.clientX; mStartY = e.clientY; moving = false;
      document.addEventListener("mousemove", onMoveDrag);
      document.addEventListener("mouseup", onMoveUp);
    };
    const onMoveDrag = (e: MouseEvent) => {
      if (!moveImg) return;
      if (!moving && Math.abs(e.clientX - mStartX) + Math.abs(e.clientY - mStartY) > 6) {
        moving = true;
        if (moveImg) moveImg.style.opacity = "0.5";
        hide(); // drop the resize overlay while moving
      }
      if (moving) { e.preventDefault(); showCaretAt(e.clientX, e.clientY); }
    };
    const onMoveUp = async (e: MouseEvent) => {
      document.removeEventListener("mousemove", onMoveDrag);
      document.removeEventListener("mouseup", onMoveUp);
      const img = moveImg;
      moveImg = null;
      removeCaret();
      if (!img) return;
      img.style.opacity = "";
      if (!moving) return; // was just a click → selection handled by onClick
      const quill = await getQuill();
      const Quill = (await import("quill")).default as any;
      if (!quill) return;
      const range = (document as any).caretRangeFromPoint?.(e.clientX, e.clientY) as Range | undefined;
      if (!range) return;
      const dropBlot = Quill.find(range.startContainer, true);
      if (!dropBlot) return;
      let dropIndex = quill.getIndex(dropBlot) + range.startOffset;
      const imgBlot = Quill.find(img);
      if (!imgBlot) return;
      const srcIndex = quill.getIndex(imgBlot);
      const html = img.outerHTML;
      quill.deleteText(srcIndex, 1, "user");
      if (dropIndex > srcIndex) dropIndex -= 1;
      dropIndex = Math.max(0, Math.min(dropIndex, quill.getLength() - 1));
      quill.clipboard.dangerouslyPasteHTML(dropIndex, html, "user");
      onChangeRef.current(quill.root.innerHTML);
    };

    const onScrollOrResize = () => position();

    wrap.addEventListener("click", onClick);
    wrap.addEventListener("mousedown", onImgMouseDown);
    const ed = findEditor();
    ed?.addEventListener("scroll", onScrollOrResize);
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      wrap.removeEventListener("click", onClick);
      wrap.removeEventListener("mousedown", onImgMouseDown);
      ed?.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("mousemove", onMoveDrag);
      document.removeEventListener("mouseup", onMoveUp);
      removeCaret();
      hide();
    };
  }, [getQuill]);

  return (
    <div ref={containerRef} className="min-h-[300px] bg-white rounded-md relative">
      <ReactQuill
        theme="snow"
        value={value}
        onChange={onChange}
        modules={modules}
        placeholder={placeholder}
        style={{ height, marginBottom: 42 }}
      />
    </div>
  );
}
