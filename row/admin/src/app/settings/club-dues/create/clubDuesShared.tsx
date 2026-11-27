import dynamic from "next/dynamic";

// forwardedRef-capable dynamic import so we can reach the Quill editor to insert tokens at the cursor.
export const ReactQuill = dynamic(async () => {
  const { default: RQ } = await import("react-quill-new");
  const Comp = ({ forwardedRef, ...props }: any) => <RQ ref={forwardedRef} {...props} />;
  Comp.displayName = "ReactQuillWithRef";
  return Comp;
}, { ssr: false });

// Insert `token` at the Quill cursor (or append if the editor ref isn't ready / exposes no editor).
export function insertQuillToken(ref: React.MutableRefObject<any>, setter: (fn: (v: string) => string) => void, token: string) {
  const q = ref.current?.getEditor?.();
  if (q) {
    const range = q.getSelection(true) || { index: q.getLength(), length: 0 };
    q.insertText(range.index, token, "user");
    q.setSelection(range.index + token.length, 0);
  } else {
    setter((v) => (v || "") + token);
  }
}

export const STEP_LABELS = ["Basic Info", "Payment & Split", "Club List", "Images & Email"];

// Vendor splits are Razorpay Route's model, off on ROW: a club's money will go to its own Stripe account.
export const SPLITS_ON = false as boolean;

export interface VendorRow { routeAccountId: string; value: string }
