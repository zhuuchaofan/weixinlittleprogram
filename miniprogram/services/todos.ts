import type { Todo, TodoInput, TodoKind } from '../models';
import { callApi } from './cloud';
import { readSnapshot, saveSnapshot } from './snapshot';

const recent = new Map<string, Todo>();

export async function listTodos(): Promise<Todo[]> {
  const todos = await callApi<Todo[]>('todo.list');
  for (const todo of todos) recent.set(todo.id, todo);
  saveSnapshot('todos', todos);
  return todos;
}

export function peekTodos(): Todo[] | undefined {
  return readSnapshot<Todo[]>('todos');
}

/** 先取列表缓存，没有时（如跨页跳转进入）再向云端取。 */
export async function getTodo(id: string): Promise<Todo> {
  const hit = recent.get(id);
  if (hit) return hit;
  const todo = await callApi<Todo>('todo.get', { id });
  recent.set(todo.id, todo);
  return todo;
}

export function addTodo(input: TodoInput): Promise<Todo> {
  return callApi<Todo>('todo.add', { ...input });
}

export function updateTodo(
  id: string,
  fields: Partial<TodoInput> & { done?: boolean },
): Promise<Todo> {
  return callApi<Todo>('todo.update', { id, ...fields });
}

export async function clearDone(kind: TodoKind): Promise<number> {
  const result = await callApi<{ removed: number }>('todo.clearDone', { kind });
  return result.removed;
}

export async function removeTodo(id: string): Promise<void> {
  await callApi<null>('todo.remove', { id });
  recent.delete(id);
}
