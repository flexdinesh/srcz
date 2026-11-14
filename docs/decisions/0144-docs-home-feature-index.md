# 0144: Docs home feature index

- Status: Accepted
- Date: 2026-11-14
- Supersedes: [0142](0142-sidebar-led-docs.md)'s docs home features list
- Keeps: 0142's lede, quick start, and Start and Guides cards, in that order

## Context

The docs home ended in a flat list of eleven features carried over from an
old README. Five described how files render; review sat in one long bullet;
walkthroughs, review feedback, the desktop app, remote hosts, Tailscale,
containers, live updates, and blame were missing. Nothing in the list linked
to the page that documents it, and its theme count went stale. The lede still
described a file browser, while the landing (0106, 0141) leads with reviewing
what agents change.

## Decision

**The lede follows the landing:** browse every file and review what agents
change, read-only, locally or on a remote machine.

**Features is a grouped index, last on the page.** Five groups follow the
landing's rows: Browse, Review, Agents, Anywhere, and Lean. Each group is the
docs home's mono section label over two columns of rows on hairlines (one
column under 768px), each row a feature's name and one line
(`src/docs/FeatureIndex.tsx`). A row links to the section that documents it,
with an arrow; hover turns the name accent. Lean's rows are facts with no page
and do not link.

Rows are lighter than the Guides cards on purpose: the cards route to pages,
the index names capabilities and deep-links into them. Copy names features,
not counts that go stale.

## Consequences

- A renamed heading breaks its row's anchor; no test checks them.
- New user-visible features should add a row in their group.
