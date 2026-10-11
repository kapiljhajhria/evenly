import { InlineEdit } from '../../components/InlineEdit.js';
import { renameGroup } from './api.js';
import { MAX_GROUP_NAME } from './constants.js';

/** Tap-to-rename group title, creator-only (see the groups update rule). */
export function EditableGroupName({ groupId, name }: { groupId: string; name: string }) {
  return (
    <InlineEdit
      value={name}
      label="Group name"
      maxLength={MAX_GROUP_NAME}
      failureMessage="Could not rename this group."
      onSave={(next) => renameGroup(groupId, next)}
      displayClassName="py-0.5 text-xl font-semibold hover:bg-slate-200/70 sm:text-2xl"
      inputClassName="text-lg font-semibold"
    />
  );
}
