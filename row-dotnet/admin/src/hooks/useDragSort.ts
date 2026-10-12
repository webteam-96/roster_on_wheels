import { useState, useCallback, useRef } from "react";

export function useDragSort<T extends { id: number }>(
  items: T[],
  setItems: (items: T[]) => void,
  onReorder: (orderedIds: number[]) => Promise<void>
) {
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const onDragStart = useCallback((idx: number) => {
    dragItem.current = idx;
    setDragging(true);
  }, []);

  const onDragEnter = useCallback((idx: number) => {
    dragOverItem.current = idx;
  }, []);

  const onDragEnd = useCallback(async () => {
    if (dragItem.current === null || dragOverItem.current === null || dragItem.current === dragOverItem.current) {
      setDragging(false);
      return;
    }
    const reordered = [...items];
    const [removed] = reordered.splice(dragItem.current, 1);
    reordered.splice(dragOverItem.current, 0, removed);
    setItems(reordered);
    dragItem.current = null;
    dragOverItem.current = null;
    setDragging(false);
    try {
      await onReorder(reordered.map((item) => item.id));
    } catch {
      // revert on error — caller should show error
    }
  }, [items, setItems, onReorder]);

  const dragProps = (idx: number) => ({
    draggable: true,
    onDragStart: () => onDragStart(idx),
    onDragEnter: () => onDragEnter(idx),
    onDragEnd,
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    style: { cursor: dragging ? "grabbing" : "grab" } as React.CSSProperties,
  });

  return { dragProps, dragging };
}
