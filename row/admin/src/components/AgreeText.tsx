/**
 * Shows an "I Agree" notice one paragraph per element. The page translator works on whole text nodes, so each
 * paragraph must be its own node to match its glossary entry; the joined notice never would.
 * Spans, not <p>: the notice sits inside a dialog description, which is already a <p>.
 */
export default function AgreeText({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n\s*\n/).map((p, i) => (
        <span key={i} className={i ? "mt-3 block" : "block"}>
          {p.trim()}
        </span>
      ))}
    </>
  );
}
