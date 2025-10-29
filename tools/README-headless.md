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
