# Headless Battle Runner

The headless battle runner exposes the Pokémon Showdown battle engine through a
simple stdin/stdout protocol. This is convenient for automated battlers such as
[poke-env](https://github.com/hsahovic/poke-env).

## Preparing the build artifacts

1. Install dependencies from the repository root: `npm install`.
2. Compile the TypeScript sources to `dist/` (also from the repository root):
   `npm run build` (or equivalently `node build`).

No additional `NODE_PATH` configuration is required after the build because the
compiled files live in `dist/` alongside their dependencies. The wrapper script
`tools/headless-battle-runner.js` will raise a clear error if `dist/` has not
been generated yet.

Once the build has completed you can launch the runner with either
`npm run headless-battle` or directly via `node tools/headless-battle-runner.js`.

The runner eagerly loads format data by calling `Dex.includeFormats()` at
startup. Caches are scoped to a single Node.js process, so if you are managing
multiple workers you should repeat that call in each worker (or ensure that the
worker is started only after the main thread has completed the call). No
cross-process coordination is required.

## CLI options

The following flags can be passed directly to `tools/headless-battle-runner.js`:

- `--log-format [text|json]` – Controls whether battle updates are emitted as
  plaintext or newline-delimited JSON documents (the default remains `text`).
- `--seed <value>` – Supplies a deterministic PRNG seed for every battle that
  starts within the process. Supplying `--seed=random` generates a unique seed
  when the process launches and reuses that value for subsequent battles.
- `--log-file <path>` – Writes all battle logs to the provided file path
  instead of STDOUT. This is useful for automated harnesses such as poke-env
  that orchestrate multiple runner instances concurrently and want to avoid
  colliding file handles.
- `--p1-team-file <path>` / `--p2-team-file <path>` – Supplies prebuilt teams
  for each side by reading the exported text (or JSON/packed) formats that
  poke-env produces. The runner validates and packs these teams before sending
  them to the battle stream.
- `--interactive-stdin` – Forwards STDIN to the simulator without any
  preprocessing so that external controllers can stream commands like
  `>player p1 team` directly. This mode cannot be combined with the team file
  options.
- `--debug`, `--no-catch`, `--keep-alive`, and `--replay` – Mirror the options
  accepted by `BattleStream` and provide finer control over simulator
  behaviour.

## poke-env usage example

When integrating with poke-env from a Python virtual environment you can
connect to the runner with a `subprocess.Popen` call. This example configures a
`gen9ou` ladder battle and requests JSON-formatted logs:

```python
from subprocess import PIPE, Popen

showdown = Popen(
    [
        "node",
        "tools/headless-battle-runner.js",
        "--format",
        "gen9ou",
        "--log-format",
        "json",
    ],
    stdin=PIPE,
    stdout=PIPE,
    cwd="/path/to/pokemon-showdown",
)
```

The process now exposes the standard Pokémon Showdown battle stream protocol,
which poke-env can consume through the returned pipes.
