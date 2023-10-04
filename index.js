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

var manuallyReview = new Set();
var suggestions = new Set();

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

function UpdateManuallyReview(fileName, path, learningPathFileAndLine, lineNumber = undefined)
{
  manuallyReview.add(AssembleOutput(fileName, path, lineNumber, undefined, learningPathFileAndLine));
  SetOutput('manuallyReview', manuallyReview)
}

function UpdateSuggestions(fileName, path, learningPathFileAndLine, oldLineNumber, newLineNumber)
{
  suggestions.add(AssembleOutput(fileName, path, oldLineNumber, newLineNumber, learningPathFileAndLine));
  SetOutput('suggestions', suggestions)
}

function SetOutput(outputName, outputSet)
{
  core.setOutput(outputName, Array.from(outputSet).join(","));
}

function AssembleOutput(fileName, path, oldLineNumber, newLineNumber, learningPathFile, learningPathLineNumber)
{
  var codeFileLink = "[" + fileName + "]" + "(" + path + ")"
  codeFileLink = AppendLineNumber(codeFileLink, oldLineNumber, newLineNumber)
  return codeFileLink + " | " + "**" + AppendLineNumber(learningPathFile, learningPathLineNumber, undefined) + "**"
}

function AppendLineNumber(text, oldLineNumber, newLineNumber)
{
  if (oldLineNumber === undefined) { return text }

  return text + " " + linePrefix + oldLineNumber + (newLineNumber === undefined ? "" : " --> " + linePrefix + newLineNumber);
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

function CompareFiles(headLearningPathFileContentStr, repoURLToSearch, modifiedPRFiles, learningPathFile)
{
  var linkIndices = [];
  for(var pos = headLearningPathFileContentStr.indexOf(repoURLToSearch); pos !== -1; pos = headLearningPathFileContentStr.indexOf(repoURLToSearch, pos + 1)) {
      linkIndices.push(pos);
  }

  for(let startIndex of linkIndices)
  {
    const endIndex = startIndex + CheckForEndOfLink(headLearningPathFileContentStr, startIndex)
    const link = headLearningPathFileContentStr.substring(startIndex, endIndex);

    const learningPathLineNumber = headLearningPathFileContentStr.substring(0, startIndex).split("\n").length;
    const learningPathFileAndLineNumber = AppendLineNumber(learningPathFile, learningPathLineNumber)

    const indexOfLineNumber = link.indexOf(linePrefix);
    const hasLineNumber = indexOfLineNumber !== -1;

    const pathStartIndex = link.indexOf("src"); // should just trim the prefix, since this might not always be the case? -> paramaterize this -> should this be more flexible, i.e. to deal with eng folder?
    const pathEndIndex = hasLineNumber ? indexOfLineNumber : endIndex;

    const trimmedFilePath = link.substring(pathStartIndex, pathEndIndex);

    if (modifiedPRFiles.indexOf(trimmedFilePath))
    {
      const fileName = trimmedFilePath.substring(trimmedFilePath.lastIndexOf('/') + 1);
      const simplifiedLink = hasLineNumber ? link.substring(0, indexOfLineNumber) : link;

      UpdateModifiedFiles(fileName, simplifiedLink, learningPathFile);

      console.log("Read Merge File: " + mergePathPrefix + trimmedFilePath);
      var mergeContent = fs.readFileSync(mergePathPrefix + trimmedFilePath, "utf8")
      if (!mergeContent)
      {
        UpdateManuallyReview(fileName, link, learningPathFileAndLineNumber);
        continue // not sure if this works
      }
      else if (!hasLineNumber) { continue }

      console.log("Read Head File: " + headPathPrefix + trimmedFilePath);
      var headContent = fs.readFileSync(headPathPrefix + trimmedFilePath, "utf8")
      if (!headContent) { continue } // not sure if this works

      const lineNumber = Number(link.substring(indexOfLineNumber + linePrefix.length, link.length));

      const mergeContentLines = mergeContent.toString().split("\n");
      const headContentLines = headContent.toString().split("\n");

      if (headContentLines.length < lineNumber || mergeContentLines.length < lineNumber)
      {
        UpdateManuallyReview(fileName, link, learningPathFileAndLineNumber, lineNumber);
      }
      else if (headContentLines[lineNumber - 1].trim() !== mergeContentLines[lineNumber - 1].trim())
      {
        const lastIndex = mergeContentLines.lastIndexOf(headContentLines[lineNumber - 1]) + 1;
        const firstIndex = mergeContentLines.indexOf(headContentLines[lineNumber - 1]) + 1;

        if (lastIndex != firstIndex) // Indeterminate; multiple matches
        {
          UpdateManuallyReview(fileName, link, learningPathFileAndLineNumber, lineNumber);
        }
        else // not a perfect heuristic, but should be good enough for most cases
        {
          UpdateSuggestions(fileName, link, learningPathFileAndLineNumber, lineNumber, firstIndex)
        }
      }
    }
  }
}

const main = async () => {

  try {
    const learningPathDirectory = core.getInput('learningPathsDirectory', { required: true });
    const repoURLToSearch = core.getInput('repoURLToSearch', { required: true });
    const headLearningPathsDirectory = headPathPrefix + learningPathDirectory;
    const paths = core.getInput('paths', {required: false});
    
    if (paths === null && paths.trim() === "") { return }

    // Scan each file in the learningPaths directory
    fs.readdir(headLearningPathsDirectory, (err, files) => {
      files.forEach(learningPathFile => {

        const headLearningFilePath = headLearningPathsDirectory + "/" + learningPathFile

        fs.readFile(headLearningFilePath, (err, headLearningPathFileContent) => {
          if (headLearningPathFileContent !== null && headLearningPathFileContent.length > 0)
          {
            CompareFiles(headLearningPathFileContent.toString(), repoURLToSearch, paths.split(' '), learningPathFile)
          }
        });
      });
    });

  } catch (error) {
    core.setFailed(error.message);
  }
}

// Call the main function to run the action
main();