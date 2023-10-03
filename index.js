// TODO:
// Don't just look for ) as end of link character
// Don't print this out every single time a change is made (or add a silencing mechanism) -> look for identical comment that already exists?
// When a broken line has multiple possible matches, handle that scenario instead of just picking the first one -> Done
// Handle cases where the learning path was already manually updated...could probably start with checking if the file was manually changed, don't scan it and assume the user has already updated it accordingly -> Done

const core = require('@actions/core');
const fs = require('fs');
const mergePathPrefix = "merge/";
const headPathPrefix = "head/";
const linePrefix = "#L";

modifiedFilesDict = {};
modifiedFilesUrlToFileName = {};

var modifiedFiles = new Set(); // output
var manuallyReview = new Set(); // output
var suggestions = new Set(); // output

function UpdateModifiedFiles(fileName, path, learningPathFile)
{
  modifiedFilesUrlToFileName[path] = fileName;

  if (modifiedFilesDict[path] !== undefined)
  {
    modifiedFilesDict[path].add(learningPathFile);
  }
  else
  {
    modifiedFilesDict[path] = new Set([learningPathFile]);
  }

  modifiedFilesDict[path] = learningPathFile;

  modifiedFiles = [];
  for (currPath in modifiedFilesDict)
  {
    const fileName = modifiedFilesUrlToFileName[currPath];
    const formattedFileNameAndUrl = "[" + fileName + "]" + "(" + currPath + ")"

    modifiedFiles = (formattedFileNameAndUrl + " | " + "**" + modifiedFilesDict[key].join(" ") + "**");
  }

  core.setOutput('modifiedFiles', Array.from(modifiedFiles).join(","));
}

function UpdateManuallyReview(fileName, path, learningPathFile)
{
  UpdateManuallyReview(fileName, path, learningPathFile, undefined);
}

function UpdateManuallyReview(fileName, path, learningPathFile, lineNumber)
{
  var pathWithLineNumber = "[" + fileName + "]" + "(" + path + ")"
  pathWithLineNumber = lineNumber == undefined ? pathWithLineNumber : pathWithLineNumber + " " + linePrefix + lineNumber;
  manuallyReview.add(pathWithLineNumber + " | " + "**" + learningPathFile + "**");
  core.setOutput('manuallyReview', Array.from(manuallyReview).join(","));
}

function UpdateSuggestions(fileName, path, learningPathFile, oldLineNumber, newLineNumber)
{
  const pathWithLineNumber = "[" + fileName + "]" + "(" + path + ")" + " " + linePrefix + oldLineNumber + " --> " + linePrefix + newLineNumber;
  suggestions.add(pathWithLineNumber + " | " + "**" + learningPathFile + "**");
  core.setOutput('suggestions', Array.from(suggestions).join(","));
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

function CompareFiles(newLearningPathFileContentStr, repoURLToSearch, modifiedFilePaths, currLearningFilePath, learningPathFile)
{
  //const linkIndices2 = extractURLsFromString(newLearningPathFileContentStr, repoURLToSearch);

  var linkIndices = [];
  for(var pos = newLearningPathFileContentStr.indexOf(repoURLToSearch); pos !== -1; pos = newLearningPathFileContentStr.indexOf(repoURLToSearch, pos + 1)) {
      linkIndices.push(pos);
  }

  for(let startIndex of linkIndices)
  {
    const endIndex = startIndex + CheckForEndOfLink(newLearningPathFileContentStr, startIndex)
    const link = newLearningPathFileContentStr.substring(startIndex, endIndex);

    const indexOfLineNumber = link.indexOf(linePrefix);
    const hasLineNumber = indexOfLineNumber !== -1;

    const pathStartIndex = link.indexOf("src"); // should just trim the prefix, since this might not always be the case? -> paramaterize this
    const pathEndIndex = hasLineNumber ? indexOfLineNumber : endIndex;

    const trimmedFilePath = link.substring(pathStartIndex, pathEndIndex);

    const pathIndex = modifiedFilePaths.indexOf(trimmedFilePath)

    const fileName = trimmedFilePath.substring(trimmedFilePath.lastIndexOf('/') + 1);

    if (pathIndex !== -1)
    {
      UpdateModifiedFiles(trimmedFilePath, learningPathFile);

      fs.readFile(mergePathPrefix + trimmedFilePath, (err, newContent) => {
        if (err || newLearningPathFileContentStr === null || newLearningPathFileContentStr.length === 0)
        {
          UpdateManuallyReview(trimmedFilePath, learningPathFile);
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
                UpdateManuallyReview(fileName, link, learningPathFile);
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
                  UpdateManuallyReview(fileName, link, learningPathFile, lineNumber);
                }
                else
                {
                  UpdateSuggestions(fileName, link, learningPathFile, lineNumber, updatedLineNumber)
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

        fs.readFile(currLearningFilePath, (err, newLearningPathFileContent) => {
          if (err) throw err;

          var newLearningPathFileContentStr = newLearningPathFileContent.toString();

          fs.readFile(existingLearningFilePath, (err, existingLearningPathFileContent) => {
            if (existingLearningPathFileContent !== null && existingLearningPathFileContent.length > 0)
            {
              var existingLearningPathFileContentStr = existingLearningPathFileContent.toString();

              if (true /*existingLearningPathFileContentStr === newLearningPathFileContentStr*/) // temp
              {
                CompareFiles(newLearningPathFileContentStr, repoURLToSearch, modifiedFilePaths, currLearningFilePath, learningPathFile)
              }
              else
              {
                // User manually made changes - assume that means they've already updated the file accordingly
              }
            }
            else
            {
              CompareFiles(newLearningPathFileContentStr, repoURLToSearch, modifiedFilePaths, currLearningFilePath, learningPathFile)
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