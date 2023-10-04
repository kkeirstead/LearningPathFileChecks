// TODO:
// Don't just look for ) as end of link character
// Don't print this out every single time a change is made (or add a silencing mechanism) -> look for identical comment that already exists? -> for potential reversions, maybe only scan the most recent LPSC check?

const core = require('@actions/core');
const fs = require('fs');
const mergePathPrefix = "merge/";
const headPathPrefix = "head/";
const linePrefix = "#L";

modifiedFilesDict = {};
modifiedFilesUrlToFileName = {};

var manuallyReview = new Set(); // output
var suggestions = new Set(); // output

function UpdateModifiedFiles(fileName, path, learningPathFile)
{
  modifiedFilesUrlToFileName[path] = fileName;

  modifiedFilesDict[path] = modifiedFilesDict[path] ? modifiedFilesDict[path] : new Set();;
  modifiedFilesDict[path].add(learningPathFile);

  var modifiedFiles = new Set();
  for (currPath in modifiedFilesDict)
  {
    const fileName = modifiedFilesUrlToFileName[currPath];
    modifiedFiles.add(AssembleOutput(fileName, currPath, undefined, undefined, Array.from(modifiedFilesDict[currPath]).join(" ")));
  }

  SetOutput('modifiedFiles', modifiedFiles)
}

function UpdateManuallyReview(fileName, path, learningPathFile, lineNumber = undefined)
{
  manuallyReview.add(AssembleOutput(fileName, path, lineNumber, undefined, learningPathFile));
  SetOutput('manuallyReview', manuallyReview)
}

function UpdateSuggestions(fileName, path, learningPathFile, oldLineNumber, newLineNumber)
{
  suggestions.add(AssembleOutput(fileName, path, oldLineNumber, newLineNumber, learningPathFile));
  SetOutput('suggestions', suggestions)
}

function SetOutput(outputName, outputSet)
{
  core.setOutput(outputName, Array.from(outputSet).join(","));
}

function AssembleOutput(fileName, path, oldLineNumber, newLineNumber, learningPathFile)
{
  return AssembleCodeFileLink(fileName, path, oldLineNumber, newLineNumber) + " | " + "**" + learningPathFile + "**"
}

function AssembleCodeFileLink(fileName, path, oldLineNumber, newLineNumber)
{
  var codeFileLink = "[" + fileName + "]" + "(" + path + ")"
  if (oldLineNumber !== undefined)
  {
    codeFileLink += " " + linePrefix + oldLineNumber;
    if (newLineNumber !== undefined) {
      codeFileLink += " --> " + linePrefix + newLineNumber;
    }
  }

  return codeFileLink;
}

// This is currently primitive - can make it better as-needed.
function CheckForEndOfLink(str, startIndex)
{
  return str.substr(startIndex).indexOf(")"); // temporary
  /*
  const illegalRegex = /^[^()\[\]{} ,]+$/ // not accounting for periods at end

  const illegalCharIndex = str.substr(startIndex).search(illegalRegex);

  return illegalCharIndex;*/
}

function CompareFiles(newLearningPathFileContentStr, existingLearningPathFileContentStr, repoURLToSearch, modifiedFilePaths, learningPathFile)
{
  var linkIndices = [];
  for(var pos = existingLearningPathFileContentStr.indexOf(repoURLToSearch); pos !== -1; pos = existingLearningPathFileContentStr.indexOf(repoURLToSearch, pos + 1)) {
      linkIndices.push(pos);
  }

  for(let startIndex of linkIndices)
  {
    const endIndex = startIndex + CheckForEndOfLink(existingLearningPathFileContentStr, startIndex)
    const link = existingLearningPathFileContentStr.substring(startIndex, endIndex);

    const learningPathFileLineNumber = existingLearningPathFileContentStr.substring(0, startIndex).split("\n").length;
    const learningPathFileAndLineNumber = learningPathFile + " " + linePrefix + learningPathFileLineNumber;

    const indexOfLineNumber = link.indexOf(linePrefix);
    const hasLineNumber = indexOfLineNumber !== -1;

    const pathStartIndex = link.indexOf("src"); // should just trim the prefix, since this might not always be the case? -> paramaterize this
    const pathEndIndex = hasLineNumber ? indexOfLineNumber : endIndex;

    const trimmedFilePath = link.substring(pathStartIndex, pathEndIndex);

    const pathIndex = modifiedFilePaths.indexOf(trimmedFilePath)

    const fileName = trimmedFilePath.substring(trimmedFilePath.lastIndexOf('/') + 1);

    if (pathIndex !== -1)
    {
      const strippedLink = hasLineNumber ? link.substring(0, indexOfLineNumber) : link;

      UpdateModifiedFiles(fileName, strippedLink, learningPathFile);

      fs.readFile(mergePathPrefix + trimmedFilePath, (err, newContent) => {
        if (err || newLearningPathFileContentStr === null || newLearningPathFileContentStr.length === 0)
        {
          UpdateManuallyReview(fileName, link, learningPathFileAndLineNumber, learningPathFileLineNumber);
        }
        else if (hasLineNumber)
        {
          fs.readFile(headPathPrefix + trimmedFilePath, (err, existingContent) => {
          
            // If the file previously didn't exist, then we don't need to check line numbers
            if (err || existingContent === null || existingContent.length === 0) {}
            else
            {
              const lineNumber = Number(link.substring(indexOfLineNumber + linePrefix.length, link.length));

              const newContentLines = newContent.toString().split("\n");
              const existingContentLines = existingContent.toString().split("\n");

              if (existingContentLines.length < lineNumber || newContentLines.length < lineNumber)
              {
                UpdateManuallyReview(fileName, link, learningPathFileAndLineNumber, learningPathFileLineNumber);
              }
              else if (existingContentLines[lineNumber - 1].trim() !== newContentLines[lineNumber - 1].trim())
              {
                const lastIndex = newContentLines.lastIndexOf(existingContentLines[lineNumber - 1]) + 1;
                const firstIndex = newContentLines.indexOf(existingContentLines[lineNumber - 1]) + 1;

                // Only a single instance of this line in the file - likely a good enough heuristic,
                // though not perfect in certain edge cases.
                var updatedLineNumber = lastIndex == firstIndex ? firstIndex : 0;

                if (updatedLineNumber === 0)
                {
                  UpdateManuallyReview(fileName, link, learningPathFileAndLineNumber, lineNumber);
                }
                else
                {
                  UpdateSuggestions(fileName, link, learningPathFileAndLineNumber, lineNumber, updatedLineNumber)
                }
              }
            }
          });
        }
      });
    }
  }
}

const main = async () => {

  try {
    const repoURLToSearch = core.getInput('repoURLToSearch', { required: true });
    const existingLearningPathsDirectory = "head/" + core.getInput('learningPathsDirectory', { required: true });
    const newLearningPathsDirectory = "merge/" + core.getInput('learningPathsDirectory', { required: true });
    const paths = core.getInput('paths', {required: false});
    
    if (paths === null && paths.trim() === "")
    {
      return;
    }

    var modifiedFilePaths = paths.split(' ');

    // Scan each file in the learningPaths directory
    fs.readdir(newLearningPathsDirectory, (err, files) => {
      files.forEach(learningPathFile => {

        const currLearningFilePath = newLearningPathsDirectory + "/" + learningPathFile
        const existingLearningFilePath = existingLearningPathsDirectory + "/" + learningPathFile

        console.log("LearningPathFile: " + learningPathFile);
        console.log("LearningPathFile URL: " + repoURLToSearch + learningPathFile)

        fs.readFile(currLearningFilePath, (err, newLearningPathFileContent) => {
          if (err) throw err;

          var newLearningPathFileContentStr = newLearningPathFileContent.toString();

          fs.readFile(existingLearningFilePath, (err, existingLearningPathFileContent) => {
            if (existingLearningPathFileContent !== null && existingLearningPathFileContent.length > 0)
            {
              var existingLearningPathFileContentStr = existingLearningPathFileContent.toString();

              if (true /*existingLearningPathFileContentStr === newLearningPathFileContentStr*/) // temp
              {
                CompareFiles(newLearningPathFileContentStr, existingLearningPathFileContentStr, repoURLToSearch, modifiedFilePaths, learningPathFile)
              }
              else
              {
                // User manually made changes - assume that means they've already updated the file accordingly
              }
            }
            else
            {
              // do nothing?
              //CompareFiles(newLearningPathFileContentStr, existingLearningPathFileContentStr, repoURLToSearch, modifiedFilePaths, learningPathFile)
            }
          });
        });
      });
    });

  } catch (error) {
    core.setFailed(error.message);
  }
}

// Call the main function to run the action
main();