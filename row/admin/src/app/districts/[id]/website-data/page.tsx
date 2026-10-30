"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getDistrict } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, AlertCircle, Globe, ImageIcon, Megaphone, Share2, Phone, List, Info, Languages } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useIsPathOff } from "@/components/FeatureGate";
import { ListPageSkeleton } from "@/components/row/AppKit";

const DISTRICT_WEBSITE_MODULES = [
  { key: "banners", name: "Banner Photos", icon: "ImageIcon", route: "banners" },
  { key: "advertisements", name: "Advertisement Area", icon: "Megaphone", route: "advertisements" },
  { key: "social_media_links", name: "Social Media Links", icon: "Share2", route: "social_media_links" },
  { key: "contact_details", name: "Contact Details", icon: "Phone", route: "contact_details" },
  { key: "menu_list", name: "Menu List", icon: "List", route: "menu_list" },
  { key: "about", name: "About", icon: "Info", route: "about" },
  { key: "languages", name: "Languages", icon: "Languages", route: "languages" },
];

function getModuleIcon(iconName: string) {
  const iconMap: Record<string, React.ReactNode> = {
    ImageIcon: <ImageIcon className="h-10 w-10 text-primary" />,
    Megaphone: <Megaphone className="h-10 w-10 text-primary" />,
    Share2: <Share2 className="h-10 w-10 text-primary" />,
    Phone: <Phone className="h-10 w-10 text-primary" />,
    List: <List className="h-10 w-10 text-primary" />,
    Info: <Info className="h-10 w-10 text-primary" />,
    Languages: <Languages className="h-10 w-10 text-primary" />,
  };
  return iconMap[iconName] || <Globe className="h-10 w-10 text-primary" />;
}

export default function DistrictWebsiteDataPage() {
  const params = useParams();
  const districtId = Number(params.id);
  const router = useRouter();
  const [districtNumber, setDistrictNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navigatingKey, setNavigatingKey] = useState<string | null>(null);
  const isPathOff = useIsPathOff(); // the cards navigate with router.push, so FeatureGate cannot hide them itself

  useEffect(() => {
    async function fetchData() {
      try {
        const district = await getDistrict(districtId);
        setDistrictNumber(district.districtNumber);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [districtId]);

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push(`/districts/${districtId}/dashboard`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">
              {districtNumber ? `District ${districtNumber} - Website Data` : "Website Data"}
            </h2>
            <p className="text-muted-foreground text-base">
              Manage district website content
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <h3 className="text-lg font-semibold">Error</h3>
            <p className="text-muted-foreground mt-2 max-w-md">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {DISTRICT_WEBSITE_MODULES.filter((mod) => !isPathOff(`/districts/${districtId}/website-data/${mod.route}`)).map((mod) => (
              <Card
                key={mod.key}
                className={`cursor-pointer hover:shadow-md hover:border-primary/30 transition-all ${navigatingKey === mod.key ? "opacity-70 pointer-events-none" : ""}`}
                onClick={() => {
                  setNavigatingKey(mod.key);
                  router.push(`/districts/${districtId}/website-data/${mod.route}`);
                }}
              >
                <CardContent className="flex flex-col items-center justify-center p-6 text-center gap-3">
                  {navigatingKey === mod.key ? (
                    <RotaryLoader size="sm" />
                  ) : (
                    getModuleIcon(mod.icon)
                  )}
                  <div>
                    <p className="font-semibold text-sm">{mod.name}</p>
                    <p className="text-xs text-muted-foreground">{mod.key}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
