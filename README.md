# Copilot Chat @verifier

A Github Copilot Chat agent that does its best to verify Python code suggestions.

This extension is a tool designed to enforce Design by Contract principles in Python code samples
generated by the corresponding Github Copilot chat participant, using the `icontract` package. It
verifies the provided code blocks using CrossHair, a symbolic execution tool for Python. If a code
block violates the pre or postconditions, the extension provides a warning message.

## Features

- Verifies Python code blocks in real-time
- Supports Design by Contract principles using the `icontract` package
- Uses CrossHair for symbolic execution of Python code
- Provides warning messages for generated code blocks that violate pre or postconditions

## How to Use

1. Start VSCode specifically enabling proposed APIs for the extension to work as expected:
   ```bash
   code --enable-proposed-api phoevos.verifier .
   ```
2. Install the extension from the VS Code marketplace
3. Open the Github Copilot chat
4. Invoke the verifier chat participant using the `@verifier` handle
5. Ask the `@verifier` to create a Python function. You can provide more information about the
   conditions that should hold true before and after the execution of the function.
6. The `@verifier` will attempt to generate the requested code, using `icontract` for adding pre
   and postconditions, and verify it using CrossHair. If the verification of the generated code
   fails, this will be noted in the chat response as a warning.

Note: The pre and post conditions are there to explicitly define the function specification. Feel
free to remove them if you decide to use the code suggestion.

## Requirements

- Python: The extension is designed to work with Python code
- Docker: The extension uses a Docker container to run the verifier, packaging the tools used for
  verification (currently CrossHair and icontract). The Docker daemon should be running at startup.
  If running the verifier in a container fails, the extension will attempt to install the required
  packages locally.
- pip: The extension defaults to using `pip` for installing `crosshair-tool` and `icontract`
  locally if the preferred container approach fails.

## Known Issues

- The extension currently only supports Python.
