// ============================================================
// Canvas — Command interface
// ============================================================
//
// Mọi mutation state (create/move/resize/delete/update) đi qua Command
// object. History stack lưu Command, KHÔNG snapshot state full. Undo
// = command.undo(); Redo = command.execute() lại.
//
// Command khi execute:
//   1. Mutate objects-store
//   2. Queue repository write (fire-and-forget, debounced trong repo)
//
// Command khi undo:
//   Ngược lại — revert store + repository.
// ============================================================

export type CommandType =
  | 'create'
  | 'move'
  | 'resize'
  | 'delete'
  | 'update'
  | 'group'
  | 'ungroup';

export interface Command {
  id: string;
  type: CommandType;
  timestamp: number;
  execute(): void;
  undo(): void;
  /** Optional merge với command tiếp theo (undo stack). Return merged
   *  Command mới hoặc null nếu không thể merge. */
  merge?(next: Command): Command | null;
}
