"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requestFreshPayLink } from "@/services/api";

/** Reached from an out-of-date pay link. The answer never says whether the address is known. */
export default function FreshPayLinkPage() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams(window.location.search);
    setSending(true);
    setError(null);
    try {
      const res = await requestFreshPayLink(params.get("kind") ?? "", Number(params.get("id")), email);
      setAnswer(res.message);
    } catch (err: any) {
      setError(err?.response?.status === 429
        ? "Too many requests. Please try again in a few minutes."
        : "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Get a new payment link</CardTitle>
        </CardHeader>
        <CardContent>
          {answer ? (
            <p className="text-sm" role="status">{answer}</p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <p className="text-sm text-muted-foreground">Enter the email address your club has for you.</p>
              <div className="space-y-2">
                <Label htmlFor="fresh-link-email">Email address</Label>
                <Input id="fresh-link-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
              <Button type="submit" disabled={sending} className="w-full">
                {sending ? "Sending" : "Email me a new link"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
