import Image from "next/image";
import logo from "@/public/brand/row-logo.png";

// The supplied compact logo, used whole and unaltered (brand guidelines, logo system).
export default function Logo({ priority = false }: { priority?: boolean }) {
  return <Image className="logo" src={logo} alt="Roster On Wheels" priority={priority} sizes="(min-width: 1024px) 240px, 160px" />;
}
