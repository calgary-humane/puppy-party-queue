"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Status = "in_progress" | "waiting" | "complete";
type Species = "Dog" | "Cat" | "Rabbits" | "Exotics" | "Other";

type Entry = {
  id: string;
  visitor_name: string | null;
  animal_name: string | null;
  species: string | null;
  counsellor: string | null;
  status: Status;
  position: number;
  created_at: string;
};

const STATUS_LABEL: Record<Status, string> = {
  in_progress: "In Progress",
  waiting: "Waiting",
  complete: "Complete",
};

const SPECIES: Species[] = ["Dog", "Cat", "Rabbits", "Exotics", "Other"];

function speciesPillClass(species: string | null) {
  const s = (species || "Other").replace(/\s/g, "");
  if (s === "Dog") return "pillDog";
  if (s === "Cat") return "pillCat";
  if (s === "Rabbits") return "pillRabbits";
  if (s === "Exotics") return "pillExotics";
  return "pillOther";
}

function SortableRow({
  entry,
  counsellors,
  onUpdate,
}: {
  entry: Entry;
  counsellors: string[];
  onUpdate: (id: string, patch: Partial<Entry>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: entry.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="gridRow rowCard">
      <input
        className="input"
        value={entry.visitor_name ?? ""}
        placeholder="Visitor"
        onChange={(e) => onUpdate(entry.id, { visitor_name: e.target.value })}
      />
      <input
        className="input"
        value={entry.animal_name ?? ""}
        placeholder="Animal"
        onChange={(e) => onUpdate(entry.id, { animal_name: e.target.value })}
      />

      <div>
        <span className={`badge ${speciesPillClass(entry.species)}`}>
          {entry.species || "Other"}
        </span>
      </div>

      <select
        value={entry.species ?? "Other"}
        onChange={(e) => onUpdate(entry.id, { species: e.target.value })}
      >
        {SPECIES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <select
        value={entry.counsellor ?? ""}
        onChange={(e) => onUpdate(entry.id, { counsellor: e.target.value })}
      >
        <option value="">—</option>
        {counsellors.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {entry.status !== "in_progress" && (
          <button onClick={() => onUpdate(entry.id, { status: "in_progress" })}>
            Claim
          </button>
        )}

        <select
          value={entry.status}
          onChange={(e) => onUpdate(entry.id, { status: e.target.value as Status })}
        >
          <option value="in_progress">{STATUS_LABEL.in_progress}</option>
          <option value="waiting">{STATUS_LABEL.waiting}</option>
          <option value="complete">{STATUS_LABEL.complete}</option>
        </select>

        <button className="ghost" {...attributes} {...listeners} aria-label="Drag">
          ↕
        </button>
      </div>
    </div>
  );
}

export default function QueueApp() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [counsellors, setCounsellors] = useState<string[]>([
    "Sue",
    "Meredith",
    "Cadence",
    "Jaidyn",
    "Emma",
    "Christyn",
  ]);

  const [visitorName, setVisitorName] = useState("");
  const [animalName, setAnimalName] = useState("");
  const [species, setSpecies] = useState<Species>("Dog");
  const [selectedCounsellor, setSelectedCounsellor] = useState("");

  const [completeCollapsed, setCompleteCollapsed] = useState(true);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const grouped = useMemo(() => {
    const inProgress = entries.filter((e) => e.status === "in_progress").sort((a, b) => a.position - b.position);
    const waiting = entries.filter((e) => e.status === "waiting").sort((a, b) => a.position - b.position);
    const complete = entries.filter((e) => e.status === "complete").sort((a, b) => a.position - b.position);
    return { inProgress, waiting, complete };
  }, [entries]);

  // Load counsellors from settings table (single row)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("settings").select("counsellors").limit(1).maybeSingle();
      if (data?.counsellors && Array.isArray(data.counsellors)) {
        setCounsellors(data.counsellors);
      }
    })();
  }, []);

  // Initial load + realtime subscribe
  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data, error } = await supabase
        .from("queue_entries")
        .select("*")
        .order("status", { ascending: true })
        .order("position", { ascending: true });

      if (!mounted) return;
      if (!error && data) setEntries(data as Entry[]);
    };

    load();

    const channel = supabase
      .channel("queue_entries_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "queue_entries" },
        () => load()
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  // Helper: next position within a status group
  const nextPosition = (status: Status) => {
    const group = entries.filter((e) => e.status === status);
    if (!group.length) return 0;
    return Math.max(...group.map((g) => g.position ?? 0)) + 1;
  };

  const addEntry = async () => {
    const v = visitorName.trim();
    const a = animalName.trim();
    if (!v || !a) return;

    await supabase.from("queue_entries").insert({
      visitor_name: v,
      animal_name: a,
      species,
      counsellor: selectedCounsellor || null,
      status: "waiting",
      position: nextPosition("waiting"),
    });

    setVisitorName("");
    setAnimalName("");
    setSpecies("Dog");
    setSelectedCounsellor("");
  };

  const updateEntry = async (id: string, patch: Partial<Entry>) => {
    // If changing status, ensure it gets a sensible position at end of new group
    let nextPatch: any = { ...patch };
    if (patch.status) {
      nextPatch.position = nextPosition(patch.status);
    }
    await supabase.from("queue_entries").update(nextPatch).eq("id", id);
  };

  const exportCSV = () => {
    const header = ["Visitor","Animal","Species","Counsellor","Status","Created"];
    const rows = entries.map(e => [
      e.visitor_name ?? "",
      e.animal_name ?? "",
      e.species ?? "",
      e.counsellor ?? "",
      STATUS_LABEL[e.status],
      e.created_at ?? ""
    ]);

    const csv = [header, ...rows]
      .map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `puppy-party-queue-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetEvent = async () => {
    const pin = prompt("Enter admin PIN to reset event:");
    if (!pin) return;

    const res = await fetch("/api/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });

    if (!res.ok) {
      alert("Wrong PIN or reset failed.");
      return;
    }
    alert("Event reset.");
  };

  const editCounsellors = async () => {
    const pin = prompt("Enter admin PIN to edit counsellors:");
    if (!pin) return;

    const current = counsellors.join("\n");
    const next = prompt("One counsellor per line:", current);
    if (next == null) return;

    const list = next
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const res = await fetch("/api/counsellors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, counsellors: list }),
    });

    if (!res.ok) {
      alert("Wrong PIN or update failed.");
      return;
    }
    setCounsellors(list);
    alert("Counsellors updated.");
  };

  const handleDragEnd = async (event: DragEndEvent, status: Status) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const group = entries
      .filter((e) => e.status === status)
      .sort((a, b) => a.position - b.position);

    const oldIndex = group.findIndex((e) => e.id === active.id);
    const newIndex = group.findIndex((e) => e.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(group, oldIndex, newIndex);

    // Reassign positions sequentially
    for (let i = 0; i < reordered.length; i++) {
      await supabase
        .from("queue_entries")
        .update({ position: i })
        .eq("id", reordered[i].id);
    }
  };

  return (
    <>
      <h1>Puppy Party Queue</h1>
      <p className="sub">Live event queue (unlisted URL). Drag rows to reorder inside each section.</p>

      <div className="card">
        <div className="sectionTitle">
          <strong>Check In Visitor</strong>
          <span className="small">Status defaults to Waiting</span>
        </div>

        <div className="toolbar">
          <input
            className="input"
            placeholder="Visitor name"
            value={visitorName}
            onChange={(e) => setVisitorName(e.target.value)}
          />
          <input
            className="input"
            placeholder="Animal name"
            value={animalName}
            onChange={(e) => setAnimalName(e.target.value)}
          />
          <select value={species} onChange={(e) => setSpecies(e.target.value as Species)}>
            {SPECIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select value={selectedCounsellor} onChange={(e) => setSelectedCounsellor(e.target.value)}>
            <option value="">Counsellor (optional)</option>
            {counsellors.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <button onClick={addEntry}>Add</button>
          <button className="secondary" onClick={exportCSV}>Export CSV</button>
          <button className="ghost" onClick={editCounsellors}>Edit counsellors</button>
          <button className="ghost" onClick={resetEvent}>Reset event</button>
        </div>
      </div>

      <div className="gridHead">
        <div>Visitor</div>
        <div>Animal</div>
        <div>Species</div>
        <div>Species (edit)</div>
        <div>Counsellor</div>
        <div>Actions</div>
      </div>

      {/* In Progress */}
      <div className="sectionTitle">
        <strong>In Progress</strong>
        <span className="small">{grouped.inProgress.length} entries</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e)=>handleDragEnd(e,"in_progress")}>
        <SortableContext items={grouped.inProgress.map(e=>e.id)} strategy={verticalListSortingStrategy}>
          {grouped.inProgress.map((entry) => (
            <SortableRow
              key={entry.id}
              entry={entry}
              counsellors={counsellors}
              onUpdate={updateEntry}
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* Waiting */}
      <div className="sectionTitle">
        <strong>Waiting</strong>
        <span className="small">{grouped.waiting.length} entries</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e)=>handleDragEnd(e,"waiting")}>
        <SortableContext items={grouped.waiting.map(e=>e.id)} strategy={verticalListSortingStrategy}>
          {grouped.waiting.map((entry) => (
            <SortableRow
              key={entry.id}
              entry={entry}
              counsellors={counsellors}
              onUpdate={updateEntry}
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* Complete */}
      <div className="sectionTitle">
        <strong>Complete</strong>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <span className="small">{grouped.complete.length} entries</span>
          <button className="ghost" onClick={()=>setCompleteCollapsed(v=>!v)}>
            {completeCollapsed ? "Show" : "Hide"}
          </button>
        </div>
      </div>

      {!completeCollapsed && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e)=>handleDragEnd(e,"complete")}>
          <SortableContext items={grouped.complete.map(e=>e.id)} strategy={verticalListSortingStrategy}>
            {grouped.complete.map((entry) => (
              <SortableRow
                key={entry.id}
                entry={entry}
                counsellors={counsellors}
                onUpdate={updateEntry}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </>
  );
}
