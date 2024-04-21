import * as vscode from "vscode";

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync, spawnSync } from "child_process";

const PARTICIPANT_NAME = "verifier";
const PARTICIPANT_FULL_NAME = "Copilot Chat @verifier";
const LANGUAGE_MODEL_ID = "copilot-gpt-3.5-turbo";
const VERIFIER_IMAGE = "phoevos/verifier:latest";
const VERIFIER_CONTAINER_NAME = "vscode-extension-verifier";

const CODE_BLOCK_REGEX = /```(\w+\n)?([^`]+)```/g;
const SUPPORTED_LANGUAGES = new Set(["python"]);
const WARNING = "Code block failed CrossHair verification with an error";

function startVerifierContainer() {
  try {
    console.log(`Checking if Docker container '${VERIFIER_CONTAINER_NAME}' is running...`);
    const dockerPsOutput = execSync('docker ps --format "{{.Names}}"').toString();
    const isContainerRunning = dockerPsOutput.split('\n').includes(VERIFIER_CONTAINER_NAME);

    if (isContainerRunning) {
      console.log(`Container ${VERIFIER_CONTAINER_NAME} is already running.`);
    } else {
      console.log(`Starting Docker container '${VERIFIER_CONTAINER_NAME}'...`);
      execSync(
        `docker run -d --rm --name ${VERIFIER_CONTAINER_NAME} ${VERIFIER_IMAGE}`,
      );
    }
  } catch (error) {
    console.error(`Failed to start Docker container: ${error}`);
    throw error;
  }
}

function stopVerifierContainer() {
  try {
    console.log(`Stopping and removing Docker container '${VERIFIER_CONTAINER_NAME}'...`);
    execSync(`docker rm -f ${VERIFIER_CONTAINER_NAME}`);
  } catch (error) {
    console.error(`Failed to remove Docker container: ${error}`);
    throw error;
  }
}

function cleanupTemporaryFiles() {
  try {
    console.log("Cleaning up temporary files...");
    const tempFiles = fs.readdirSync(os.tmpdir()).filter((file) => {
      return file.startsWith("verifier-");
    });
    tempFiles.forEach((file) => {
      fs.unlinkSync(path.join(os.tmpdir(), file));
    });
  } catch (error) {
    console.error(`Failed to cleanup temporary files: ${error}`);
  }
}

/**
 * Setup the verifier environment
 * @returns false if setup completed using a Docker container
 * @returns true if setup completed using local pip packages
 */
function setup(): boolean {
  try {
    startVerifierContainer();
    return false;
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to start Docker container for @verifier: ${error}`,
    );
    vscode.window.showInformationMessage(
      "Installing pip dependencies locally...",
    );
    try {
      console.log("Installing crosshair and icontract pip packages locally...");
      execSync("pip install crosshair-tool icontract");
      console.log("Successfully installed crosshair and icontract");
      return true;
    } catch (installError) {
      console.error(
        `Failed to install crosshair and icontract: ${installError}`,
      );
      vscode.window.showErrorMessage(
        `Failed to install crosshair and icontract: ${installError}`,
      );
      throw installError;
    }
  }
}

function getContextHistory(context: vscode.ChatContext): string {
  // Concatenate the history of the context from prompts and responses
  var history = "";
  for (const item of context.history) {
    if (item instanceof vscode.ChatRequestTurn) {
      history += item.prompt;
    } else if (item instanceof vscode.ChatResponseTurn) {
      for (const r of item.response) {
        if (r instanceof vscode.ChatResponseMarkdownPart) {
          history += r.value.value;
        }
      }
    }
  }
  return history;
}

function verifyCodeBlock(
  local: boolean,
  codeBlock: string,
  languageIdentifier: string,
  stream: vscode.ChatResponseStream,
): {
  markdownBlock: string;
  verifiable: boolean;
  error: string;
} {
  stream.progress("Verifying code block...");

  const originalCodeBlock =
    "```" + languageIdentifier + "\n" + codeBlock + "```";

  if (!SUPPORTED_LANGUAGES.has(languageIdentifier)) {
    return {
      markdownBlock: originalCodeBlock,
      verifiable: false,
      error: `Unsupported language: ${languageIdentifier}`,
    };
  }

  try {
    // Write the Python code to a temporary file and run CrossHair on it
    const tempFileName = path.join(os.tmpdir(), `verifier-${Date.now()}.py`);
    fs.writeFileSync(tempFileName, codeBlock);

    var result;
    if (local) {
      result = spawnSync("crosshair", ["check", tempFileName]);
    } else {
      // Run CrossHair in the verifier container
      execSync(`docker cp ${tempFileName} ${VERIFIER_CONTAINER_NAME}:${tempFileName}`);
      const command = `docker exec \
        ${VERIFIER_CONTAINER_NAME} \
        crosshair check ${tempFileName}`;
      result = spawnSync(command, { shell: true });
    }

    // If CrossHair didn't output anything, the code block is valid
    return {
      markdownBlock: originalCodeBlock,
      verifiable: true,
      error: result.stdout?.toString().trim(),
    };
  } catch (error) {
    console.error(error);
    return {
      markdownBlock: originalCodeBlock,
      verifiable: true,
      error: error?.toString() ?? "",
    };
  }
}

export function activate(context: vscode.ExtensionContext) {
  const local = setup();

  vscode.window.showInformationMessage(
    `Loaded ${PARTICIPANT_FULL_NAME}. This agent is meant to enforce Design by Contract principles
    in Python code samples, using the icontract package. It attempts to verify the provided code
    blocks using CrossHair, an analysis tool for Python used for symbolic execution. If a code
    block violates the pre or postconditions, the agent provides a warning message.`,
  );

  async function handler(
    prompt: string,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ) {
    const messages = [
      new vscode.LanguageModelChatSystemMessage(
        `Your job is to enforce Design by Contract principles whenever generating code samples in
        Python, using the icontract package. You should use the require and ensure decorators to
        wrap the functions you generate, setting pre and postconditions through lambda functions.
        You should also provide a descriptive error message string as the second argument, in case
        the condition is violated. The conditions should never call the function itself. Make sure
        that you import the icontract package at the beginning of the code block.`,
      ),
      new vscode.LanguageModelChatUserMessage(getContextHistory(context)),
      new vscode.LanguageModelChatUserMessage(prompt),
    ];

    try {
      const chatResponse = await vscode.lm.sendChatRequest(
        LANGUAGE_MODEL_ID,
        messages,
        {},
        token,
      );

      var message = "";
      for await (const fragment of chatResponse.stream) {
        message += fragment;
      }

      var codeBlocks = [];
      var match;
      while ((match = CODE_BLOCK_REGEX.exec(message)) !== null) {
        const languageIdentifier = match[1].trim();
        const codeBlock = match[2];
        const verification = verifyCodeBlock(
          local,
          codeBlock,
          languageIdentifier,
          stream,
        );
        codeBlocks.push({
          code: verification.markdownBlock,
          index: match.index,
          verifiable: verification.verifiable,
          error: verification.error,
        });
      }

      var failedVerificationBlocks = codeBlocks.filter(
        (block) => block.verifiable && block.error,
      );
      if (failedVerificationBlocks.length === 0) {
        stream.markdown(message);
      } else {
        var newMessage = message;
        failedVerificationBlocks.forEach((block) => {
          const warningBlock = `**@${PARTICIPANT_NAME}: ${WARNING}:**`;
          const errorBlock = `**${block.error}**`;
          const codeBlock = block.code;
          newMessage = newMessage.replace(
            codeBlock,
            `${warningBlock}\n${errorBlock}\n${codeBlock}`,
          );
        });
        stream.markdown(newMessage);
      }
    } catch (error) {
      console.error(error);
    }
  }

  const verifier = vscode.chat.createChatParticipant(
    PARTICIPANT_NAME,
    async (
      request: vscode.ChatRequest,
      context: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken,
    ) => {
      await handler(request.prompt, context, stream, token);
      return {};
    },
  );
  verifier.iconPath = vscode.Uri.joinPath(
    context.extensionUri,
    "assets/verifier.png",
  );
  context.subscriptions.push(verifier);
}

export function deactivate() {
  stopVerifierContainer();
  cleanupTemporaryFiles();
}
