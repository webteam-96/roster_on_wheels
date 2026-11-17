/**
 * Shows an "I Agree" notice one paragraph per element. The page translator works on whole text nodes, so each
 * paragraph must be its own node to match its glossary entry; the joined notice never would.
 */
export default function AgreeText({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n\s*\n/).map((p, i) => (
        <p key={i} className={i ? "mt-3" : undefined}>
          {p.trim()}
        </p>
      ))}
    </>
  );
}
