import { useMemo, useRef, useState } from 'react';
import type { SkillRef } from '@conduit/shared';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Search } from 'lucide-react';
import type { DiscoveredSkill } from '../../api/types.js';
import { cn } from '../../lib/cn.js';

interface Props {
  /** Skills already filtered to the agent's provider. */
  skills: DiscoveredSkill[];
  /** The agent's current `skills` selection. */
  selected: SkillRef[];
  onChange: (next: SkillRef[]) => void;
}

/** Synthetic groups sort after real plugins; everything else is alphabetical. */
const TRAILING_GROUPS = new Set(['Worker', 'Repo']);

interface SkillGroup {
  name: string;
  marketplace?: string;
  skills: DiscoveredSkill[];
}

/**
 * Skill selector for the agent config panel — mirrors the MCP `ToolAllowList`
 * popover (same `search-select-*` shell) but the list is sectioned by the
 * plugin/marketplace each skill came from, with a per-group "all" toggle. One
 * compact "N of M skills" trigger replaces the old wall of skill cards.
 */
export function SkillPicker({ skills, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.skillId)), [selected]);
  const byId = useMemo(() => new Map(skills.map((s) => [s.id, s])), [skills]);

  const groups = useMemo(() => groupSkills(skills), [skills]);
  const filteredGroups = useMemo(() => filterGroups(groups, query), [groups, query]);

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

  const toggleGroup = (group: SkillGroup) => {
    const ids = group.skills.map((s) => s.id);
    const allSelected = ids.every((id) => selectedIds.has(id));
    const next = new Set(selectedIds);
    for (const id of ids) {
      if (allSelected) next.delete(id);
      else next.add(id);
    }
    setSelectedIds(next);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <Popover.Trigger className={cn('select-trigger w-full', open && 'search-select-open')}>
        <span className="search-select-value font-mono text-[11px]">
          {selectedIds.size > 0
            ? `${selectedIds.size} of ${skills.length} skills`
            : `Select skills (${skills.length} available)`}
        </span>
        <span className={cn('select-trigger-chevron', open && 'search-select-chevron-open')}>
          <ChevronDown size={12} strokeWidth={1.5} />
        </span>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          sideOffset={4}
          align="start"
          className="search-select-content"
          style={{ maxHeight: 340 }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <div className="search-select-input-row">
            <Search size={12} strokeWidth={1.5} className="search-select-icon" />
            <input
              ref={inputRef}
              className="search-select-input"
              placeholder="Filter skills…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="search-select-list">
            {filteredGroups.length === 0 && (
              <div className="search-select-empty">No matching skills</div>
            )}
            {filteredGroups.map((group) => {
              const selectedInGroup = group.skills.filter((s) => selectedIds.has(s.id)).length;
              return (
                <div key={group.name}>
                  <div className="flex items-center justify-between px-2 pb-1 pt-2">
                    <div className="min-w-0 truncate font-mono text-[10px] uppercase tracking-wide text-[var(--color-text-3)]">
                      {group.name}
                      {group.marketplace && (
                        <span className="text-[var(--color-text-4)]"> · {group.marketplace}</span>
                      )}
                    </div>
                    <button
                      className="flex-shrink-0 font-mono text-[10px] text-[var(--color-text-3)] hover:text-[var(--color-text)]"
                      onClick={() => toggleGroup(group)}
                    >
                      {selectedInGroup === group.skills.length ? 'none' : 'all'}
                    </button>
                  </div>
                  {group.skills.map((skill) => (
                    <label
                      key={skill.id}
                      className={cn(
                        'select-item flex items-start gap-2',
                        selectedIds.has(skill.id) && 'search-select-item-selected',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(skill.id)}
                        onChange={() => toggle(skill.id)}
                        className="mt-0.5 flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-[11px]">{skill.name}</div>
                        {skill.description && (
                          <div className="truncate font-mono text-[10px] text-[var(--color-text-3)]">
                            {skill.description}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function groupSkills(skills: DiscoveredSkill[]): SkillGroup[] {
  const map = new Map<string, SkillGroup>();
  for (const skill of skills) {
    let group = map.get(skill.group);
    if (!group) {
      group = { name: skill.group, marketplace: skill.marketplace, skills: [] };
      map.set(skill.group, group);
    }
    group.skills.push(skill);
  }
  return Array.from(map.values()).sort(compareGroups);
}

function compareGroups(a: SkillGroup, b: SkillGroup): number {
  const aTrailing = TRAILING_GROUPS.has(a.name);
  const bTrailing = TRAILING_GROUPS.has(b.name);
  if (aTrailing !== bTrailing) return aTrailing ? 1 : -1;
  return a.name.localeCompare(b.name);
}

function filterGroups(groups: SkillGroup[], query: string): SkillGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((group) => ({
      ...group,
      skills: group.skills.filter(
        (s) =>
          s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
      ),
    }))
    .filter((group) => group.skills.length > 0);
}
