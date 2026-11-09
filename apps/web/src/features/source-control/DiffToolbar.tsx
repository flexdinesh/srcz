import { Menu } from "@base-ui/react/menu"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, ChevronsDownUpIcon, ChevronsUpDownIcon, Columns2Icon, PanelRightIcon, Rows2Icon, Settings2Icon } from "lucide-react"

import { IconButton } from "../../components/ui/icon-button.tsx"
import { menuGroupLabelClass, menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../../components/ui/menu.ts"
import { SegmentedControl, SegmentedItem } from "../../components/ui/segmented-control.tsx"
import { diffOptionsModified, effectiveDiffStyle, inlineChoices, type DiffOptions } from "./diff-options.ts"

interface DiffToolbarProps {
  options: DiffOptions
  narrow: boolean
  // hasChanges: the review has files whose changes steps can reach.
  hasChanges: boolean
  // anyExpanded: some file's diff is open, so the action collapses all.
  anyExpanded: boolean
  onChange(change: Partial<DiffOptions>): void
  onExpandAll(expand: boolean): void
  onStepHunk(direction: 1 | -1): void
  // files toggles the review's Files rail, or opens its sheet on phones;
  // absent for reviews without one.
  files?: { shown: boolean; onToggle(): void }
}

const splitUnavailable = "Split view needs a wider window"
const noChanges = "No changes to step through"

// toggles are the View options menu's on/off options.
const toggles: ReadonlyArray<{ option: "wrap" | "ignoreWhitespace" | "expandUnchanged"; label: string; title: string }> = [
  { option: "wrap", label: "Wrap lines", title: "Wrap long lines" },
  { option: "ignoreWhitespace", label: "Ignore whitespace", title: "Ignore leading and trailing whitespace" },
  { option: "expandUnchanged", label: "Expand unchanged lines", title: "Show every unchanged line" },
]

// DiffToolbar sits in the document mode-toggle slot for a review tab:
// layout, change steps, Collapse All, and Files stay on the bar; Wrap,
// Ignore whitespace, Expand unchanged, and Inline changes share one View
// options menu (decision 0117).
export function DiffToolbar({ anyExpanded, files, hasChanges, narrow, onChange, onExpandAll, onStepHunk, options }: DiffToolbarProps) {
  const style = effectiveDiffStyle(options, narrow)
  const modified = diffOptionsModified(options)
  return (
    <div className="diff-toolbar">
      <SegmentedControl className="document-mode-toggle diff-layout" aria-label="Diff layout">
        <SegmentedItem aria-label="Split" pressed={style === "split"} aria-disabled={narrow || undefined}
          title={narrow ? splitUnavailable : "Split"} onClick={() => { if (!narrow) onChange({ style: "split" }) }}>
          <Columns2Icon aria-hidden="true" />
        </SegmentedItem>
        <SegmentedItem aria-label="Unified" pressed={style === "unified"} title="Unified"
          onClick={() => onChange({ style: "unified" })}>
          <Rows2Icon aria-hidden="true" />
        </SegmentedItem>
      </SegmentedControl>
      <Menu.Root>
        <Menu.Trigger className="diff-view-options" data-modified={modified || undefined}
          render={<IconButton label="View options" title={modified ? "View options (changed)" : "View options"}
            icon={<Settings2Icon aria-hidden="true" />} />} />
        <Menu.Portal>
          <Menu.Positioner className={menuPositionerClass} sideOffset={4} align="end">
            <Menu.Popup className={menuPopupClass} aria-label="View options">
              {toggles.map((toggle) => (
                <Menu.CheckboxItem key={toggle.option} className={menuItemClass} checked={options[toggle.option]}
                  title={toggle.title} onCheckedChange={(checked) => onChange({ [toggle.option]: checked })}>
                  <Menu.CheckboxItemIndicator className="diff-option-check" keepMounted>
                    <CheckIcon aria-hidden="true" />
                  </Menu.CheckboxItemIndicator>
                  {toggle.label}
                </Menu.CheckboxItem>
              ))}
              <Menu.Separator className={menuSeparatorClass} />
              <Menu.Group>
                <Menu.GroupLabel className={menuGroupLabelClass}>Inline changes</Menu.GroupLabel>
                <Menu.RadioGroup value={options.inline} onValueChange={(value: unknown) => {
                  const choice = inlineChoices.find((entry) => entry.value === value)
                  if (choice) onChange({ inline: choice.value })
                }}>
                  {inlineChoices.map((choice) => (
                    <Menu.RadioItem key={choice.value} className={menuItemClass} value={choice.value}>
                      <Menu.RadioItemIndicator className="diff-option-check" keepMounted>
                        <CheckIcon aria-hidden="true" />
                      </Menu.RadioItemIndicator>
                      {choice.label}
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
              </Menu.Group>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <span className="diff-hunk-steps">
        <IconButton label="Previous change" title="Previous change (Shift+F7)" aria-keyshortcuts="Shift+F7"
          icon={<ChevronUpIcon aria-hidden="true" />} disabledReason={hasChanges ? undefined : noChanges}
          onClick={() => onStepHunk(-1)} />
        <IconButton label="Next change" title="Next change (F7)" aria-keyshortcuts="F7"
          icon={<ChevronDownIcon aria-hidden="true" />} disabledReason={hasChanges ? undefined : noChanges}
          onClick={() => onStepHunk(1)} />
      </span>
      <IconButton className="diff-open-file" label={anyExpanded ? "Collapse All Files" : "Expand All Files"}
        icon={anyExpanded ? <ChevronsDownUpIcon aria-hidden="true" /> : <ChevronsUpDownIcon aria-hidden="true" />}
        onClick={() => onExpandAll(!anyExpanded)} />
      {files && (
        <IconButton label="Files" title={files.shown ? "Hide Files" : "Show Files"} aria-pressed={files.shown}
          icon={<PanelRightIcon aria-hidden="true" />} onClick={files.onToggle} />
      )}
    </div>
  )
}
