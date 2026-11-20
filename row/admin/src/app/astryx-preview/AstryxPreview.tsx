"use client";

import { useState } from "react";
import { Theme } from "@astryxdesign/core/theme";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Selector } from "@astryxdesign/core/Selector";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Switch } from "@astryxdesign/core/Switch";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { Table } from "@astryxdesign/core/Table";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Pagination } from "@astryxdesign/core/Pagination";
import { DateInput } from "@astryxdesign/core/DateInput";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { fellowshipTheme } from "@/astryx/fellowshipTheme";
import { Button as RowButton } from "@/components/ui/button";
import { Badge as RowBadge } from "@/components/ui/badge";
import { Input as RowInput } from "@/components/ui/input";

const THEMES = { fellowship: fellowshipTheme };
type ThemeKey = keyof typeof THEMES;
const NAMES: Record<ThemeKey, string> = { fellowship: "ROW Fellowship" };

interface Member extends Record<string, unknown> {
  name: string;
  club: string;
  role: string;
  status: string;
}
const MEMBERS: Member[] = [
  { name: "Samuel Tubman", club: "Monrovia Central", role: "President", status: "Active" },
  { name: "Grace Kollie", club: "Monrovia Central", role: "Secretary", status: "Active" },
  { name: "Joseph Doe", club: "Paynesville", role: "Member", status: "Dues pending" },
];

function Gallery() {
  const [name, setName] = useState("");
  const [club, setClub] = useState("monrovia");
  const [agree, setAgree] = useState(true);
  const [notify, setNotify] = useState(false);
  const [tab, setTab] = useState("members");
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(2);
  const [date, setDate] = useState<string | undefined>("2026-11-12");

  return (
    <VStack gap={6}>
      <VStack gap={1}>
        <Heading level={2}>Club members</Heading>
        <Text type="supporting">Sample data. Every widget below is an Astryx component.</Text>
      </VStack>

      <TabList value={tab} onChange={setTab}>
        <Tab value="members" label="Members" />
        <Tab value="dues" label="Dues" />
        <Tab value="reports" label="Reports" />
      </TabList>

      <HStack gap={2}>
        <Button variant="primary" label="Add member" />
        <Button variant="secondary" label="Export" />
        <Button variant="ghost" label="Cancel" />
        <Button variant="destructive" label="Remove" />
        <Button variant="primary" label="Saving" isLoading />
      </HStack>

      <HStack gap={2}>
        <Badge variant="success" label="Active" />
        <Badge variant="warning" label="Dues pending" />
        <Badge variant="error" label="Terminated" />
        <Badge variant="info" label="New" />
        <Badge variant="neutral" label="View only" />
      </HStack>

      <Banner status="warning" title="Trial ends in 5 days" description="Choose a plan to keep the club website online." />

      <Card>
        <VStack gap={4}>
          <Heading level={3}>Member details</Heading>
          <HStack gap={4}>
            <TextInput label="Full name" value={name} onChange={setName} placeholder="e.g. Grace Kollie" isRequired />
            <Selector
              label="Club"
              value={club}
              onChange={setClub}
              options={[
                { value: "monrovia", label: "Monrovia Central" },
                { value: "paynesville", label: "Paynesville" },
              ]}
            />
            <DateInput label="Joined on" value={date as never} onChange={(v) => setDate(v)} />
          </HStack>
          <CheckboxInput label="Agrees to the club's privacy policy" value={agree} onChange={setAgree} />
          <Switch label="Email the member about club events" value={notify} onChange={setNotify} />
          <HStack gap={2}>
            <Button variant="primary" label="Open dialog" onClick={() => setOpen(true)} />
          </HStack>
        </VStack>
      </Card>

      <Table<Member>
        data={MEMBERS}
        columns={[
          { key: "name", header: "Name" },
          { key: "club", header: "Club" },
          { key: "role", header: "Role" },
          { key: "status", header: "Status" },
        ]}
      />
      <Pagination page={page} onChange={setPage} totalPages={8} />

      <VStack gap={2}>
        <Text type="label">Loading state</Text>
        <Skeleton height={16} width="60%" />
        <Skeleton height={16} width="40%" />
      </VStack>

      <Dialog isOpen={open} onOpenChange={setOpen}>
        <DialogHeader title="Remove member?" subtitle="Grace Kollie, Monrovia Central" onOpenChange={setOpen} />
        <div style={{ padding: 16 }}>
          <VStack gap={4}>
            <Text>The member keeps their history. You can add them back later.</Text>
            <HStack gap={2}>
              <Button variant="destructive" label="Remove" onClick={() => setOpen(false)} />
              <Button variant="secondary" label="Keep" onClick={() => setOpen(false)} />
            </HStack>
          </VStack>
        </div>
      </Dialog>
    </VStack>
  );
}

export default function AstryxPreview() {
  const [key, setKey] = useState<ThemeKey>("fellowship");
  return (
    <div data-no-translate className="min-h-screen bg-cream p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-2 text-sm font-semibold text-ink">Theme:</span>
          {(Object.keys(THEMES) as ThemeKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKey(k)}
              className={`rounded-md border px-3 py-1.5 text-sm ${k === key ? "border-azure bg-azure text-cream" : "border-stone-tone text-ink"}`}
            >
              {NAMES[k]}
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-stone-tone p-4">
          <p className="mb-3 text-sm font-semibold text-ink">Today in admin (current components, for comparison)</p>
          <div className="flex flex-wrap items-center gap-2">
            <RowButton>Add member</RowButton>
            <RowButton variant="outline">Export</RowButton>
            <RowButton variant="ghost">Cancel</RowButton>
            <RowButton variant="destructive">Remove</RowButton>
            <RowBadge>Active</RowBadge>
            <div className="w-56">
              <RowInput placeholder="e.g. Grace Kollie" />
            </div>
          </div>
        </div>

        <Theme theme={THEMES[key]}>
          <div className="rounded-lg border border-stone-tone p-6" style={{ background: "var(--color-background-body)" }}>
            <Gallery />
          </div>
        </Theme>
      </div>
    </div>
  );
}
