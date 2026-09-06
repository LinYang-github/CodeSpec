# Stores (beta)

> Plan changes that span repositories: one store, many repos.

CodeSpec normally lives inside one repo: an `codespec/` folder next to the code it plans. A store moves that folder into a repository of its own, and several code repos can share it.

After a one-time setup on each machine, commands like `status`, `new change`, and `archive` can work in the store from any directory.

```
         team-plans  (a store: CodeSpec in its own repo)
         ├── .codespec-store/store.yaml   the store's name
         └── codespec/
             ├── specs/
             └── changes/
                   ▲
                   │ set up once on each machine,
                   │ shared by pushing and cloning like any repo
     ┌─────────────┼─────────────┐
     │             │             │
 web-app       api-server     mobile-app
(code repo)   (code repo)    (code repo)
```

You share a store with git, the same way you share code: commit, push, pull, and review it yourself. Specs and changes get branches and pull requests the same way code does.

## When you need one

Two common reasons to use a store:

- **Frontend and backend in separate repos**: one feature touches both, and the plan needs a single home instead of two halves.

  ```
        shop-plans  (store)
        └── codespec/changes/add-discounts/    one plan for the feature
                  ▲
        ┌─────────┴─────────┐
        │                   │
    storefront             api
  (frontend repo)     (backend repo)
  ```

- **One product, several client repos**: Android, iOS, and web ship from their own repos but share one expected behavior. A spec describes behavior, not implementation, so one spec serves all three.

  ```
          product-specs  (store)
          └── codespec/specs/checkout/spec.md    the expected behavior
                    ▲
      ┌─────────────┼─────────────┐
      │             │             │
  android-app    ios-app       web-app
  (code repo)   (code repo)   (code repo)
  ```

You can have more than one store, though we recommend keeping the count low.

## Set up a store

One person creates the store, then everyone else joins it.

1. **Create the store** (one person, once per team). Run `codespec store setup` and answer the prompts:

   ```bash
   # run from anywhere; it asks what to create and where
   codespec store setup
   ```
   
   It asks three questions:
   
   - **Store name**: `team-plans`
   - **Where should this store live?**: pre-filled with `~/codespec/<name>`, press Enter to accept it or type another path
   - **Create this store?**: shows what it's about to make, answer `Yes`
   
   Then it reports what it created:
   
   ```yaml
   Store ready: team-plans
   Location: ~/codespec/team-plans
   CodeSpec root: ready
   Registry: registered
   
   Next: run normal CodeSpec commands against this store, for example:
     codespec new change <change-id> --store team-plans
   Share this store by committing and pushing it like any Git repo.
   ```

2. **Push it to your git host.** Create an empty `team-plans` repo on your host first. Setup doesn't add a git remote, so connect the store to that repo, then push:

   ```bash
   # connect the store to the empty repo on your git host
   cd ~/codespec/team-plans
   git remote add origin git@github.com:acme/team-plans.git

   # publish it
   git push -u origin main
   ```
   
3. **Join the store** (every teammate, once per machine):
   
   ```bash
   # get the store onto your machine
   git clone git@github.com:acme/team-plans.git ~/codespec/team-plans
   
   # tell CodeSpec where it lives
   codespec store register ~/codespec/team-plans
   ```

   ```yaml
   Store registered: team-plans
   Location: /Users/you/codespec/team-plans
   CodeSpec root: ready
   Registry: registered
   ```
   
   Registering tells your machine where this store lives. The store's name is already committed inside it, in `.codespec-store/store.yaml`. Setup registered the creator's copy, so only cloned copies need this step.
   
4. **Confirm it worked**, from any directory:
   
   ```bash
   # any CodeSpec command reaches the store by name
   codespec status --store team-plans
   ```

   ```yaml
   Using CodeSpec root: team-plans (/Users/you/codespec/team-plans)
   No active changes. Create one with: codespec new change <name> --store team-plans
   ```
   
## Types of setups

CodeSpec has three setups. The rest of this page uses these names:

- **repo-local**: CodeSpec inside your repo, no store. The default.
- **store-only**: your repo keeps no specs or changes of its own. Everything lives in the store.
- **store-optional**: your project has its own `codespec/` folder and also reaches a store when you ask.

### The default: CodeSpec inside your repo (`repo-local`)

`codespec init` puts an `codespec/` folder next to your code, and that repo's specs and changes live there. No store is involved. This is the setup [Set up your project](../start/setup.md) teaches, and most projects never need another.

```
web-app  (code repo)
└── codespec/
    ├── specs/
    └── changes/
```

### CodeSpec outside your repo, in a store (`store-only`)

The repo keeps no specs or changes of its own. Everything it plans lives in the store, and one line in the repo's config connects the two.

Common when one team builds all the repos and plans in one place. The [examples above](#when-you-need-one) all have this shape.

```
team-plans  (store)
└── codespec/
    ├── specs/       the repo's specs live here
    └── changes/     its changes too
          ▲
          │ store: team-plans   (the connecting line)
web-app  (code repo)
└── codespec/
    └── config.yaml    nothing else
```

### CodeSpec in your repo and in a store (`store-optional`)

The repo stays repo-local for its own work, while the store holds the shared specs and changes. Inside the repo, CodeSpec uses your project's `codespec/` folder, and reaches the store only when you pass `--store`.

Common when a repo used CodeSpec before the store existed, or when a mostly independent repo only occasionally touches shared work.

```
team-plans  (store)
└── codespec/          the shared specs and changes
          ▲
          │ only when you pass --store team-plans
web-app  (code repo)
└── codespec/          this repo's own
    ├── config.yaml
    ├── specs/
    └── changes/
```

A repo can start repo-local and move its specs and changes into the store later. [Move a repo's specs and changes into the store](#move-a-repos-specs-and-changes-into-the-store) shows how.

## Where artifacts get created when using stores

When you use a store, CodeSpec also has to decide where the artifacts get created. It depends on your setup:

- **store-only** (your project only writes to the store): every artifact is created in the store. The `store:` line below records that.
- **store-optional** (your project has its own `codespec/` folder and also uses a store): artifacts are created in your project, unless you name the store in your request or pass `--store` for that change. Your agent then carries the flag through the rest of the workflow.

CodeSpec writes artifacts to one of two places: your project's `codespec/` folder, or the store's. It picks in this order, and the first option that applies wins:

1. **`--store <id>` on a command.** Always wins, from any directory.
2. **Your project's `codespec/` folder.** If your project has its own `specs/` or `changes/` folders, CodeSpec uses them.
3. **The `store:` line in your project.** How a store-only project records its store.
4. **`defaultStore` on your machine.** The fallback when none of the above applies.

Whichever applied, CodeSpec's first output line names the folder it acted on (`Using CodeSpec root: ...`). The exact rules, including the error cases, are in [Configuration › Stores](../reference/configuration/stores.md).

### The `store:` line (store-only projects)

Add one line to your project's `codespec/config.yaml`:

```yaml
# web-app/codespec/config.yaml
store: team-plans
```

Everything you or your agent run inside your project now uses the store, with no flag to type:

```bash
# inside web-app, connected
codespec status
```

```yaml
Using CodeSpec root: team-plans (/Users/you/codespec/team-plans)
No active changes. Create one with: codespec new change <name> --store team-plans
```

- **Without the line**: run a plain command in a store-only project and CodeSpec stops with an error listing your registered stores.
- **Commit it**: teammates who clone your project get the line too. They still need the store registered on their machine ([step 3 of Set up a store](#set-up-a-store)), or CodeSpec errors and tells them to register it.
- **Next to real folders**: if your project also has `specs/` or `changes/` folders, CodeSpec uses those and ignores the line, with a warning.

### `defaultStore` on your machine

Set it once if every project you work in uses the same store. CodeSpec falls back to it when it finds no flag, no local `codespec/` folder, and no `store:` line:

```bash
# use team-plans whenever nothing else names a store
codespec config set defaultStore team-plans

# undo it
codespec config unset defaultStore
```

**Commands that stay local.** `init`, `update`, `templates`, `schemas`, and the `codespec schema` subcommands act on the current directory only and take no `--store`.

## Move a repo's specs and changes into the store

To take a repo from repo-local to store-only:

1. Move everything in the repo's `codespec/specs/` and `codespec/changes/` into the same folders in the store.
2. Delete the now-empty folders, so the repo's `codespec/` folder holds only `config.yaml`.
3. Add the `store:` line to that `config.yaml`.

`codespec status` inside the repo now starts with `Using CodeSpec root: team-plans`.

## Work in the store

The workflows don't change, for you or for your agent. Propose, apply, and archive run the way they always do. The only difference is where the artifacts get created, and [the section above](#where-artifacts-get-created-when-using-stores) covers that.

Create a change from inside a store-only repo and it lands in the store:

```bash
# inside web-app; the store: line routes this to team-plans
codespec new change add-login
```

```yaml
Using CodeSpec root: team-plans (/Users/you/codespec/team-plans)
Created change 'add-login' at /Users/you/codespec/team-plans/codespec/changes/add-login/
Schema: spec-driven
Next: codespec status --change add-login --store team-plans
```

- **Where it went**: into the store repo, not next to your code.
- **Sharing it**: the change exists only in your checkout until you commit and push the store repo. Teammates see it when they pull. The same goes for every artifact the workflows write.
- **Paths in the docs**: wherever the docs show an `codespec/` path, in a store setup that folder is the store's.

When artifacts get created somewhere you didn't expect, `codespec doctor` checks your setup without changing anything and prints a fix for each finding:

```bash
# check the current root and its stores
codespec doctor
```

```yaml
Doctor

Root
  Location: /Users/you/codespec/team-plans
  CodeSpec root: ok
  Store: team-plans (metadata ok)

References
  (none declared)
```

`codespec context` lists the root and stores your current directory works with, when you want the same picture without the checks.

To open the store and a repo in one editor window, so your agent can read both, see [Worksets (beta)](worksets.md).

## Read specs from another store

Your repo can keep its own `codespec/` folder and still let your agent read another store's specs. Declare that store under `references:` in the repo's `codespec/config.yaml`:

```yaml
# api-server/codespec/config.yaml
references:
  - team-plans
```

References are read-only. Your work stays in your repo, and the reference only changes what your agent is told.

When a workflow creates an artifact, its instructions gain an index of the referenced store's specs, each with a one-line summary and the exact command to fetch it:

```xml
<referenced_stores>
<!-- Read-only upstream context. Fetch what you need; cite what you use. -->
Store team-plans (/Users/you/codespec/team-plans):
  - payments: Rules for charging and refunding customers.
  Fetch: codespec show <spec-id> --type spec --store team-plans
</referenced_stores>
```

A reference can also carry the store's clone URL, for machines that don't have that store yet:

```yaml
references:
  - team-plans
  - { id: design-system, remote: "git@github.com:acme/design-system.git" }
```

With the URL declared, `codespec doctor` turns a missing store into a pasteable fix:

```yaml
# output wrapped to fit
References
  - team-plans: ok (/Users/you/codespec/team-plans)
  - design-system: Referenced store 'design-system' is not registered on this machine.
    Fix: git clone -- git@github.com:acme/design-system.git '/Users/you/codespec/design-system' &&
         codespec store register '/Users/you/codespec/design-system' --id design-system
```

## Beta limits

- **The shape may change**: command names, flags, and file formats can change between releases. Re-read this page after upgrading.
- **No sync, by design**: CodeSpec never clones, pulls, or pushes. A stale checkout shows stale specs until you pull, and references are read from whatever is on disk.
- **One checkout per store name**: registering a second folder under a name that's already registered fails, with a hint to run `codespec store unregister` first.
