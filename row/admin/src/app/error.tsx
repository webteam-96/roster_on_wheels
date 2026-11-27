"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <div className="text-center space-y-4">
        <h2 className="row-h2">Something went wrong</h2>
        <p className="text-muted-foreground">{error.message}</p>
        <Button
          onClick={() => reset()}
          
        >
          Try again
        </Button>
      </div>
    </div>
  );
}import { Button } from "@/components/ui/button";

