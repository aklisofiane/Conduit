import { useMemo } from 'react';
import type { SkillRef } from '@conduit/shared';
import type { DiscoveredSkill } from '../../api/types.js';
import {
  CheckboxListPopover,
  type CheckboxListGroup,
} from '../ui/checkbox-list-popover.js';

interface Props {
  /** Skills already filtered to the agent's provider. */
  skills: DiscoveredSkill[];
  /** The agent's current `skills` selection. */
  selected: SkillRef[];
  onChange: (next: SkillRef[]) => void;
}

/** Synthetic groups sort after real plugins; everything else is alphabetical. */
const TRAILING_GROUPS = new Set(['Worker', 'Repo']);

// Stable accessors so the popover's filter `useMemo` isn't invalidated each render.
const skillId = (s: DiscoveredSkill) => s.id;
const skillName = (s: DiscoveredSkill) => s.name;
const skillDescription = (s: DiscoveredSkill) => s.description;

/**
 * Skill selector for the agent config panel — mirrors the MCP tool allow-list
 * popover (same {@link CheckboxListPopover} shell) but the list is sectioned by
 * the plugin/marketplace each skill came from, with a per-group "all" toggle.
 * One compact "N of M skills" trigger replaces the old wall of skill cards.
 */
export function SkillPicker({ skills, selected, onChange }: Props) {
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.skillId)), [selected]);
  const byId = useMemo(() => new Map(skills.map((s) => [s.id, s])), [skills]);

  const setSelectedIds = (ids: Set<string>) => {
    onChange(
      Array.from(ids)
        .map((id) => byId.get(id))
        .filter((s): s is DiscoveredSkill => s !== undefined)
        .map((s) => ({ skillId: s.id, source: s.source })),
    );
  };

  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleMany = (ids: string[], select: boolean) => {
    const next = new Set(selectedIds);
    for (const id of ids) {
      if (select) next.add(id);
      else next.delete(id);
    }
    setSelectedIds(next);
  };

  return (
    <CheckboxListPopover
      items={skills}
      getId={skillId}
      getLabel={skillName}
      getDescription={skillDescription}
      selectedIds={selectedIds}
      onToggle={toggle}
      onToggleMany={toggleMany}
      triggerClassName="w-full"
      maxHeight={340}
      placeholder="Filter skills…"
      emptyLabel="No matching skills"
      triggerLabel={
        selectedIds.size > 0
          ? `${selectedIds.size} of ${skills.length} skills`
          : `Select skills (${skills.length} available)`
      }
      groupItems={groupSkills}
    />
  );
}

function groupSkills(skills: DiscoveredSkill[]): CheckboxListGroup<DiscoveredSkill>[] {
  const map = new Map<string, CheckboxListGroup<DiscoveredSkill>>();
  for (const skill of skills) {
    let group = map.get(skill.group);
    if (!group) {
      group = { name: skill.group, meta: skill.marketplace, items: [] };
      map.set(skill.group, group);
    }
    group.items.push(skill);
  }
  return Array.from(map.values()).sort(compareGroups);
}

function compareGroups(
  a: CheckboxListGroup<DiscoveredSkill>,
  b: CheckboxListGroup<DiscoveredSkill>,
): number {
  const aTrailing = TRAILING_GROUPS.has(a.name);
  const bTrailing = TRAILING_GROUPS.has(b.name);
  if (aTrailing !== bTrailing) return aTrailing ? 1 : -1;
  return a.name.localeCompare(b.name);
}
