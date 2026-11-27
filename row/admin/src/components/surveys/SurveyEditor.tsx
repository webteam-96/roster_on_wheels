"use client";

/**
 * One survey of a club or district ("new" starts one): the questions while it is a draft, publish and close, then the
 * results with a chart per question and a CSV download (api/Controllers/SurveysController.cs).
 */

import { Table, TableBody, TableRow, TableCell } from "@/components/ui/table"
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/row/AppKit";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Lock, Plus, Save, Send, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ErrorAlert from "@/components/ErrorAlert";
import { Skeleton, TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { useFormat } from "@/hooks/useFormat";
import {
  closeSurvey, createSurvey, deleteSurvey, downloadSurveyCsv, getSurvey, getSurveyResults, getSurveySubGroups,
  publishSurvey, updateSurvey,
} from "@/services/api";
import { emptyQuestion, isChoice, STATE_LABEL, toBody, toForm, TYPE_LABEL, type QuestionRow, type SurveyForm } from "@/lib/surveys";
import type { QuestionType, Survey, SurveyQuestionResult, SurveyResults, SurveyScope, SurveySubGroup } from "@/types/surveys";

const SELECT = "row-field w-full";
const BAR_FILL = "hsl(var(--primary))";
const AXIS = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const message = (err: any, fallback: string) => err?.response?.data?.message || fallback;

interface Props {
  scope: SurveyScope;
  scopeId: number | null | undefined;
  /** "new" or the survey id from the route. */
  param: string;
  basePath: string;
}

function QuestionChart({ q }: { q: SurveyQuestionResult }) {
  const fmt = useFormat();
  if (q.type === "text") {
    return q.textAnswers.length === 0 ? (
      <p className="text-sm text-muted-foreground">No written answers yet.</p>
    ) : (
      <ul className="max-h-72 space-y-2 overflow-y-auto text-sm">
        {q.textAnswers.map((t, i) => (
          <li key={i} className="border-b pb-2 last:border-0">
            <p className="whitespace-pre-wrap">{t.text}</p>
            {t.name && <p className="text-xs text-muted-foreground">{t.name}</p>}
          </li>
        ))}
      </ul>
    );
  }
  const data = q.options.map((o) => ({ label: o.label, count: o.count, percent: o.percent }));
  return (
    <div className="space-y-2">
      {q.type === "rating" && (
        <p className="text-sm">Average rating: <span className="font-semibold tabular-nums">{q.ratingAverage == null ? "none yet" : fmt.number(q.ratingAverage)}</span> of 5</p>
      )}
      <div style={{ height: Math.max(120, data.length * 36) }} role="img" aria-label={`Answers to ${q.text}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
            <XAxis type="number" allowDecimals={false} tick={AXIS} />
            <YAxis type="category" dataKey="label" width={140} tick={AXIS} />
            <Tooltip formatter={(v, _n, item) => [`${v} (${(item?.payload as { percent: number }).percent}%)`, "Answers"]} />
            <Bar dataKey="count" fill={BAR_FILL} radius={[0, 2, 2, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Table className="w-full text-sm">
        <TableBody>
          {data.map((o) => (
            <TableRow key={o.label} className="border-b last:border-0">
              <TableCell className="py-1">{o.label}</TableCell>
              <TableCell className="py-1 text-right tabular-nums">{fmt.number(o.count)}</TableCell>
              <TableCell className="w-20 py-1 text-right tabular-nums text-muted-foreground">{o.percent}%</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function SurveyEditor({ scope, scopeId, param, basePath }: Props) {
  const fmt = useFormat();
  const router = useRouter();
  const isNew = param === "new";
  const id = isNew ? 0 : Number(param);
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [form, setForm] = useState<SurveyForm | null>(isNew ? toForm(null) : null);
  const [results, setResults] = useState<SurveyResults | null>(null);
  const [subGroups, setSubGroups] = useState<SurveySubGroup[]>([]);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const show = (s: Survey) => {
    setSurvey(s);
    setForm(toForm(s));
    if (s.state !== "draft" && scopeId) getSurveyResults(scope, scopeId, s.id).then(setResults).catch(() => setError("Could not load the results."));
  };

  useEffect(() => {
    if (!scopeId || scope !== "clubs") return;
    getSurveySubGroups(scopeId).then(setSubGroups).catch(() => setSubGroups([]));
  }, [scope, scopeId]);

  useEffect(() => {
    if (!scopeId || isNew) return;
    setSurvey(null);
    getSurvey(scope, scopeId, id).then(show).catch(() => setMissing(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, scopeId, id, isNew]);

  if (!scopeId) return <p className="p-6 text-sm text-muted-foreground">Choose a {scope === "clubs" ? "club" : "district"} first.</p>;
  if (missing) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm">This survey was not found.</p>
        <Link href={basePath} className="text-sm text-primary underline">Back to the surveys</Link>
      </div>
    );
  }
  if (!form) {
    return (
      <div className="space-y-4 p-6" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
        <TableSkeleton rows={4} />
      </div>
    );
  }

  const draft = isNew || survey?.state === "draft";
  const set = (patch: Partial<SurveyForm>) => setForm({ ...form, ...patch });
  const setQ = (i: number, patch: Partial<QuestionRow>) => set({ questions: form.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
  const moveQ = (i: number, by: number) => {
    const qs = [...form.questions];
    const [q] = qs.splice(i, 1);
    qs.splice(i + by, 0, q);
    set({ questions: qs });
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await work();
    } catch (err) {
      setError(message(err, "Something went wrong."));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      if (isNew) {
        const { id: newId } = await createSurvey(scope, scopeId, toBody(form));
        router.replace(`${basePath}/${newId}`);
        return;
      }
      show(await updateSurvey(scope, scopeId, id, toBody(form)));
      setNotice("Saved.");
    });

  const publish = () =>
    run(async () => {
      if (!window.confirm("Publish this survey? Its questions can no longer change, and the audience is notified when it opens.")) return;
      show(await updateSurvey(scope, scopeId, id, toBody(form)));
      show(await publishSurvey(scope, scopeId, id));
      setNotice("Published.");
    });

  const close = () =>
    run(async () => {
      if (!window.confirm("Close this survey now? Members can no longer answer.")) return;
      show(await closeSurvey(scope, scopeId, id));
      setNotice("Closed.");
    });

  const remove = () =>
    run(async () => {
      if (!window.confirm("Delete this survey and all its answers? This cannot be undone.")) return;
      await deleteSurvey(scope, scopeId, id);
      router.replace(basePath);
    });

  const download = () =>
    run(async () => {
      const blob = await downloadSurveyCsv(scope, scopeId, id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `survey-${id}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title={isNew ? "New survey" : survey?.title}
        description={survey && ( <p className="text-sm text-muted-foreground"> {STATE_LABEL[survey.state]}. Opens {fmt.dateTime(survey.opensAt)}, closes {fmt.dateTime(survey.closesAt)}. {survey.audienceCount != null && ` Audience: ${fmt.number(survey.audienceCount)} people.`} </p> )}
        back={basePath}
        actions={
          <>
{survey?.state === "draft" && (
            <Button onClick={publish} disabled={busy}><Send className="h-4 w-4" /> Publish</Button>
          )}
          {(survey?.state === "open" || survey?.state === "scheduled") && (
            <Button variant="outline" onClick={close} disabled={busy}><Lock className="h-4 w-4" /> Close now</Button>
          )}
          {survey && survey.state !== "draft" && (
            <Button variant="outline" onClick={download} disabled={busy}><Download className="h-4 w-4" /> Download CSV</Button>
          )}
          {survey && (
            <Button variant="outline" onClick={remove} disabled={busy} className="text-destructive"><Trash2 className="h-4 w-4" /> Delete</Button>
          )}
          </>
        }
      />

      {notice && <p className="text-sm text-primary" role="status">{notice}</p>}

      <Card>
        <CardContent className="grid gap-4 p-5 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="sv-title">Title</Label>
            <Input id="sv-title" value={form.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="sv-desc">Introduction (optional)</Label>
            <Textarea id="sv-desc" value={form.description} maxLength={2000} rows={3} onChange={(e) => set({ description: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sv-opens">Opens (your time)</Label>
            <Input id="sv-opens" type="datetime-local" value={form.opensAt} disabled={!draft} onChange={(e) => set({ opensAt: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sv-closes">Closes (your time)</Label>
            <Input id="sv-closes" type="datetime-local" value={form.closesAt} disabled={survey?.state === "closed"} onChange={(e) => set({ closesAt: e.target.value })} />
          </div>
          {scope === "clubs" ? (
            <div className="space-y-1.5">
              <Label htmlFor="sv-audience">Who is asked</Label>
              <NativeSelect id="sv-audience"  value={form.subGroupId} disabled={!draft} onChange={(e) => set({ subGroupId: e.target.value })}>
                <option value="">All active members</option>
                {subGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </NativeSelect>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground md:col-span-2">
              Asked: the district&apos;s officers (this Rotary year&apos;s district committee and Assistant Governors).
            </p>
          )}
          <div className="flex flex-col justify-end gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.isAnonymous} disabled={!draft} onCheckedChange={(v) => set({ isAnonymous: v === true })} />
              Anonymous: no one, admins included, sees who answered what
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.showResults} onCheckedChange={(v) => set({ showResults: v === true })} />
              Members see the results after they answer
            </label>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3" aria-labelledby="sv-questions">
        <h3 id="sv-questions" className="row-h2">Questions</h3>
        {!draft && <p className="text-sm text-muted-foreground">The questions are fixed once a survey is published.</p>}
        {form.questions.map((q, i) => (
          <Card key={i}>
            <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_200px]">
              <div className="space-y-1.5">
                <Label htmlFor={`sv-q${i}`}>Question {i + 1}</Label>
                <Input id={`sv-q${i}`} value={q.text} maxLength={500} disabled={!draft} onChange={(e) => setQ(i, { text: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`sv-t${i}`}>Answer type</Label>
                <NativeSelect id={`sv-t${i}`}  value={q.type} disabled={!draft} onChange={(e) => setQ(i, { type: e.target.value as QuestionType })}>
                  {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </NativeSelect>
              </div>
              {isChoice(q.type) && (
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor={`sv-o${i}`}>Options, one per line (2 to 20)</Label>
                  <Textarea id={`sv-o${i}`} rows={4} value={q.options} disabled={!draft} onChange={(e) => setQ(i, { options: e.target.value })} />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 md:col-span-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={q.required} disabled={!draft} onCheckedChange={(v) => setQ(i, { required: v === true })} /> Needs an answer
                </label>
                {draft && (
                  <>
                    <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => moveQ(i, -1)}>Move up</Button>
                    <Button variant="ghost" size="sm" disabled={i === form.questions.length - 1} onClick={() => moveQ(i, 1)}>Move down</Button>
                    <Button variant="ghost" size="sm" className="text-destructive" disabled={form.questions.length === 1}
                      onClick={() => set({ questions: form.questions.filter((_, j) => j !== i) })}>Remove</Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {draft && (
          <Button variant="outline" onClick={() => set({ questions: [...form.questions, emptyQuestion()] })} disabled={form.questions.length >= 50}>
            <Plus className="h-4 w-4" /> Add a question
          </Button>
        )}
      </section>

      {survey?.state !== "closed" && (
        <Button onClick={save} disabled={busy}><Save className="h-4 w-4" /> {isNew ? "Save draft" : "Save changes"}</Button>
      )}

      {survey && survey.state !== "draft" && (
        <section className="space-y-3" aria-labelledby="sv-results">
          <h3 id="sv-results" className="row-h2">Results</h3>
          {!results ? (
            <div aria-busy="true"><Skeleton className="h-40 w-full" /></div>
          ) : (
            <>
              <p className="text-sm">
                <span className="font-semibold tabular-nums">{fmt.number(results.responseCount)}</span> of {fmt.number(results.audienceCount)} answered
                ({results.responseRate}%).{results.isAnonymous && " Anonymous: names are never shown."}
              </p>
              {results.responseCount === 0 ? (
                <Card><CardContent className="p-5 text-sm text-muted-foreground">No answers yet.</CardContent></Card>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {results.questions.map((q) => (
                    <Card key={q.questionId}>
                      <CardContent className="space-y-3 p-4">
                        <div>
                          <p className="font-medium">{q.text}</p>
                          <p className="text-xs text-muted-foreground">{TYPE_LABEL[q.type]}, {fmt.number(q.answered)} answered</p>
                        </div>
                        <QuestionChart q={q} />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}
