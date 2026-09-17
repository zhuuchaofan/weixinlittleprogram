import { uiCopy } from '../config/ui-copy';
import type { GuestMessageInput, RsvpInput } from '../models';
export function validateRsvp(input: RsvpInput): string {
  if (
    typeof input.guestName !== 'string' ||
    !input.guestName.trim() ||
    input.guestName.trim().length > 30
  )
    return uiCopy.validation.text01;
  if (typeof input.attending !== 'boolean') return uiCopy.validation.text02;
  if (
    !Number.isInteger(input.partySize) ||
    (input.attending
      ? input.partySize < 1 || input.partySize > 10
      : input.partySize !== 0)
  )
    return uiCopy.validation.text03;
  if (typeof input.note !== 'string' || input.note.length > 200)
    return uiCopy.validation.text04;
  if (input.consent !== true) return uiCopy.validation.text05;
  return '';
}
export function validateGuestMessage(input: GuestMessageInput): string {
  if (typeof input.signature !== 'string' || input.signature.trim().length > 30)
    return uiCopy.validation.text07;
  if (
    typeof input.message !== 'string' ||
    !input.message.trim() ||
    input.message.trim().length > 120
  )
    return uiCopy.validation.text08;
  if (input.consent !== true) return uiCopy.validation.text09;
  return '';
}
export function friendlyError(error: unknown): string {
  return error instanceof Error ? error.message : uiCopy.validation.text06;
}
