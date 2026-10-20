import type { Todo, TodoInput } from '../models';
import { callApi } from './cloud';

const recent = new Map<string, Todo>();

export async function listTodos(): Promise<Todo[]> {
  const todos = await callApi<Todo[]>('todo.list');
  for (const todo of todos) recent.set(todo.id, todo);
  return todos;
}

export function cachedTodo(id: string): Todo | undefined {
  return recent.get(id);
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

export async function removeTodo(id: string): Promise<void> {
  await callApi<null>('todo.remove', { id });
  recent.delete(id);
}
