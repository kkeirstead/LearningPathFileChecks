// TODO:
// Don't just look for ) as end of link character
// Don't print this out every single time a change is made (or add a silencing mechanism) -> look for identical comment that already exists? -> for potential reversions, maybe only scan the most recent LPSC check?

const core = require('@actions/core');
const fs = require('fs');
const mergePathPrefix = "merge/";
const headPathPrefix = "head/";
const linePrefix = "#L";
const sourceDirectoryName = core.getInput('sourceDirectoryName', { required: true });

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

function UpdateManuallyReview(fileName, path, learningPathFile, learningPathLineNumber, lineNumber = undefined)
{
  manuallyReview.add(AssembleOutput(fileName, path, lineNumber, undefined, learningPathFile, learningPathLineNumber));
  SetOutput('manuallyReview', manuallyReview)
}

function UpdateSuggestions(fileName, path, learningPathFile, learningPathLineNumber, oldLineNumber, newLineNumber)
{
  suggestions.add(AssembleOutput(fileName, path, oldLineNumber, newLineNumber, learningPathFile, learningPathLineNumber));
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

function CheckForEndOfLink(str, startIndex)
{
  const illegalCharIndex = str.substr(startIndex).search("[(), '`\"\]\[\}\{]|\. ");
  return illegalCharIndex;
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

    const indexOfLinePrefix = link.indexOf(linePrefix);
    const hasLineNumber = indexOfLinePrefix !== -1;

    const pathStartIndex = link.indexOf(sourceDirectoryName);
    if (pathStartIndex === -1) { continue } // test this works by including an eng file?

    const pathEndIndex = hasLineNumber ? indexOfLinePrefix : endIndex;

    const trimmedFilePath = link.substring(pathStartIndex, pathEndIndex);

    if (modifiedPRFiles.includes(trimmedFilePath))
    {
      const fileName = trimmedFilePath.substring(trimmedFilePath.lastIndexOf('/') + 1);
      const simplifiedLink = hasLineNumber ? link.substring(0, indexOfLinePrefix) : link;

      UpdateModifiedFiles(fileName, simplifiedLink, learningPathFile);

      const learningPathLineNumber = headLearningPathFileContentStr.substring(0, startIndex).split("\n").length;

      var mergeContent = ""

      try {
        mergeContent = fs.readFileSync(mergePathPrefix + trimmedFilePath, "utf8")
      }
      catch (error) {
        UpdateManuallyReview(fileName, link, learningPathFile, learningPathLineNumber);
        continue // not sure if this works
      }

      if (!hasLineNumber) { continue }

      var headContent = ""
      try {
        headContent = fs.readFileSync(headPathPrefix + trimmedFilePath, "utf8")
      }
      catch (error) {
        continue // not sure if this works
      }

      const lineNumber = Number(link.substring(indexOfLinePrefix + linePrefix.length, link.length));

      const mergeContentLines = mergeContent.toString().split("\n");
      const headContentLines = headContent.toString().split("\n");

      if (headContentLines.length < lineNumber) // This shouldn't happen, unless the learning path is already out of date.
      {
        UpdateManuallyReview(fileName, link, learningPathFile, learningPathLineNumber, lineNumber);
      }
      else if (mergeContentLines.length < lineNumber || headContentLines[lineNumber - 1].trim() !== mergeContentLines[lineNumber - 1].trim())
      {
        const lastIndex = mergeContentLines.lastIndexOf(headContentLines[lineNumber - 1]) + 1;
        const firstIndex = mergeContentLines.indexOf(headContentLines[lineNumber - 1]) + 1;

        if (lastIndex != firstIndex) // Indeterminate; multiple matches
        {
          UpdateManuallyReview(fileName, link, learningPathFile, learningPathLineNumber, lineNumber);
        }
        else // not a perfect heuristic, but should be good enough for most cases
        {
          UpdateSuggestions(fileName, link, learningPathFile, learningPathLineNumber, lineNumber, firstIndex)
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

        try {
          const headLearningPathFileContent = fs.readFileSync(headLearningPathsDirectory + "/" + learningPathFile, "utf8")
          if (headLearningPathFileContent)
          {
            CompareFiles(headLearningPathFileContent, repoURLToSearch, paths.split(' '), learningPathFile)
          }
        } catch (error) {
          console.log("Could not find file: " + learningPathFile)
        }
      });
    });

  } catch (error) {
    core.setFailed(error.message);
  }
}

// Call the main function to run the action
main();