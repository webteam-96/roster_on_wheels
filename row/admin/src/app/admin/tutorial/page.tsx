import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, PlayCircle, BookOpen, Sparkles } from "@/components/icons";

export const metadata: Metadata = {
  title: "Tutorials | ROW",
  description:
    "Step-by-step video guides and walkthroughs for the ROW administration platform. Coming soon.",
};

const BRAND_NAVY = "#17458f";
const BRAND_GOLD = "#F7A81B";

export default function TutorialPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <main className="flex-1 relative overflow-hidden flex items-center">

        <section className="relative w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 lg:py-20">
          {/* Hero card */}
          <div className="relative bg-white border rounded-3xl overflow-hidden"
               style={{ borderColor: "rgba(30,58,95,0.10)" }}>
            {/* Top accent strip */}
            <div className="h-1.5 w-full" style={{ background: BRAND_GOLD }} />

            <div className="px-6 sm:px-12 lg:px-16 py-12 sm:py-16 lg:py-20 flex flex-col items-center text-center">
              {/* Logo */}
              <div className="mb-8 sm:mb-10 flex flex-col items-center gap-4">
                <div className="relative">
                  <Image
                    src="/brand/row-logo.png"
                    alt="ROW"
                    width={320}
                    height={100}
                    className="relative h-20 sm:h-24 w-auto object-contain"
                    priority
                  />
                </div>
                <p className="text-xs sm:text-sm font-semibold tracking-[0.2em] uppercase"
                   style={{ color: BRAND_NAVY }}>
                  ROW · 5 · 6 · 7 · 8
                </p>
              </div>

              {/* Coming soon chip */}
              <div
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold mb-6 border"
                style={{
                  background: "rgba(247,168,27,0.10)",
                  borderColor: "rgba(247,168,27,0.35)",
                  color: BRAND_NAVY,
                }}
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"
                        style={{ background: BRAND_GOLD }} />
                  <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: BRAND_GOLD }} />
                </span>
                <Sparkles size={14} style={{ color: BRAND_GOLD }} />
                <span>Tutorials: Coming Soon</span>
              </div>

              {/* Headline */}
              <h1
                className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-4"
                style={{ color: BRAND_NAVY }}
              >
                Coming Soon
              </h1>
              <p className="max-w-2xl text-base sm:text-lg text-slate-600 leading-relaxed mb-10">
                Step-by-step video walkthroughs and written guides for every module of the
                ROW administration platform are on the way.
                Check back shortly.
              </p>

              {/* Feature trio — preview of what's coming */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 w-full max-w-2xl mb-10">
                <FeatureCard
                  icon={<PlayCircle size={22} style={{ color: BRAND_GOLD }} />}
                  title="Video Guides"
                  desc="Short, focused screencasts for every flow."
                />
                <FeatureCard
                  icon={<BookOpen size={22} style={{ color: BRAND_GOLD }} />}
                  title="Step-by-Step Docs"
                  desc="Read-along instructions with screenshots."
                />
              </div>

              {/* Back to home */}
              <Link
                href="/"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold text-white shadow-md hover:shadow-lg transition-shadow"
                style={{ background: BRAND_NAVY }}
              >
                <ArrowLeft size={16} />
                Back to Home
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div
      className="bg-white/70 border rounded-2xl p-5 text-left hover:shadow-md transition-shadow"
      style={{ borderColor: "rgba(30,58,95,0.08)" }}
    >
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="text-sm font-bold" style={{ color: BRAND_NAVY }}>
          {title}
        </h3>
      </div>
      <p className="text-xs sm:text-sm text-slate-600 leading-snug">{desc}</p>
    </div>
  );
}
