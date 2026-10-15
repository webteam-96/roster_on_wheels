import Image from "next/image";
import logo from "@/public/brand/row-logo.png";

// The handshake loader: the logo, clipped into its gold hand, blue hand and wordmark.
// Shown on the first page of a visit only (html.row-loader, set in app/layout.tsx); pure CSS, ~1.7s.
export default function Loader() {
  const sizes = "(min-width: 768px) 420px, 64vw";
  return (
    <div className="loader" aria-hidden="true">
      <div className="loader__logo">
        <Image className="loader__g" src={logo} alt="" sizes={sizes} preload />
        <Image className="loader__b" src={logo} alt="" sizes={sizes} loading="eager" />
        <Image className="loader__w" src={logo} alt="" sizes={sizes} loading="eager" />
        <span className="loader__spark" />
      </div>
    </div>
  );
}
