// TODO:
// Don't just look for ) as end of link character
// Don't print this out every single time a change is made (or add a silencing mechanism) -> look for identical comment that already exists? -> for potential reversions, maybe only scan the most recent LPSC check?

const core = require('@actions/core');
const fs = require('fs');
const prevPathPrefix = "prev/";
const headPathPrefix = "head/";
const linePrefix = "#L";
const sourceDirectoryName = core.getInput('sourceDirectoryName', { required: true });
const oldHash = core.getInput('oldHash', { required: true });
const newHash = core.getInput('newHash', { required: true });
const excludeLinks = core.getInput('excludeLinks', { required: false });
const excludeLinksArray = excludeLinks ? excludeLinks.split(',').map(function(item) { return item.toLowerCase().trim() }) : [];

modifiedFilesDict = {};
modifiedFilesUrlToFileName = {};

var outOfSync = new Set();
var manuallyReview = new Set();
var suggestions = new Set();

// Modified Files - Any files that have been modified in the PR that are present in a learning path
function UpdateModifiedFiles(fileName, path, learningPathFile)
{
  modifiedFilesUrlToFileName[path] = fileName;

  modifiedFilesDict[path] = modifiedFilesDict[path] ? modifiedFilesDict[path] : new Set();;
  modifiedFilesDict[path].add(learningPathFile);

  var modifiedFiles = new Set();
  for (currPath in modifiedFilesDict)
  {
    const fileName = modifiedFilesUrlToFileName[currPath];
    modifiedFiles.add(AssembleModifiedFilesOutput(fileName, currPath, Array.from(modifiedFilesDict[currPath])));
  }

  SetOutput('modifiedFiles', modifiedFiles)
}

function AssembleModifiedFilesOutput(fileName, path, learningPathFiles)
{
  var codeFileLink = "[" + fileName + "]" + "(" + path + ")"
  return codeFileLink + " | **" + learningPathFiles.join(" ") + "**";
}

// Manually Review - The PR Author should manually review these files to determine if they need to be updated;
// this could be due to deletions, renames, or references to ambiguous lines (such as a newline) that cannot
// be uniquely identified.
function UpdateManuallyReview(fileName, path, learningPathFile, learningPathLineNumber, lineNumber = undefined)
{
  manuallyReview.add(AssembleOutput(fileName, path, undefined, lineNumber, undefined, learningPathFile, learningPathLineNumber))
  SetOutput('manuallyReview', manuallyReview)
}

function UpdateOutOfSync(link, learningPathFile)
{
  outOfSync.add(link + " | **" + learningPathFile + "**")

  SetOutput('outOfSync', outOfSync)
}

// Suggestions - A line reference has changed in this PR, and the PR Author should update the line accordingly.
// There are edge cases where this may make an incorrect recommendation, so the PR author should verify that
// this is the correct line to reference.
function UpdateSuggestions(fileName, oldPath, newPath, learningPathFile, learningPathLineNumber, oldLineNumber, newLineNumber)
{
  suggestions.add(AssembleOutput(fileName, oldPath, newPath, oldLineNumber, newLineNumber, learningPathFile, learningPathLineNumber))
  SetOutput('suggestions', suggestions)
}

function SetOutput(outputName, outputSet)
{
  core.setOutput(outputName, Array.from(outputSet).join(","))
}

function AssembleOutput(fileName, oldPath, newPath, oldLineNumber, newLineNumber, learningPathFile, learningPathLineNumber)
{
  var oldCodeFileLink = "[" + fileName + "]" + "(" + oldPath + ")"
  oldCodeFileLink = AppendLineNumber(oldCodeFileLink, oldLineNumber)
  var combinedCodeFileLink = oldCodeFileLink;

  if (newPath && newLineNumber) {
    var newCodeFileLink = "[" + fileName + "]" + "(" + newPath + ")"
    newCodeFileLink = AppendLineNumber(newCodeFileLink, newLineNumber)
    combinedCodeFileLink += " -> " + newCodeFileLink;
  }

  return combinedCodeFileLink + " | **update this link in " + AppendLineNumber(learningPathFile, learningPathLineNumber, undefined) + "**"
}

function AppendLineNumber(text, lineNumber)
{
  if (!lineNumber) { return text }

  return text + " " + linePrefix + lineNumber
}

function CheckForEndOfLink(str, startIndex)
{
  const illegalCharIndex = str.substr(startIndex).search("[(), '\`\"\}\{]|\. "); // This regex isn't perfect, but should cover most cases.
  return illegalCharIndex;
}

function CompareFiles(headLearningPathFileContentStr, repoURLToSearch, modifiedPRFiles, learningPathFile)
{
  // Get all indices where a link to the repo is found within the current learning path file
  var linkIndices = [];
  for(var pos = headLearningPathFileContentStr.indexOf(repoURLToSearch); pos !== -1; pos = headLearningPathFileContentStr.indexOf(repoURLToSearch, pos + 1)) {
      linkIndices.push(pos);
  }

  for(let startOfLink of linkIndices)
  {
    // Clean up the link, determine if it has a line number suffix
    const endOfLink = startOfLink + CheckForEndOfLink(headLearningPathFileContentStr, startOfLink)
    const link = headLearningPathFileContentStr.substring(startOfLink, endOfLink);

    for (let excludeLink of excludeLinksArray)
    {
      console.log("");
      console.log("Exclude Link: " + excludeLink);
      console.log("Link: " + link.toLowerCase());
      if (link.toLowerCase().includes(excludeLink)) { console.log("Excluded"); continue; }
    }

    if (!link.includes(oldHash))
    {
      UpdateOutOfSync(link, learningPathFile);

      continue
    }

    const pathStartIndex = link.indexOf(sourceDirectoryName);
    if (pathStartIndex === -1) { continue }

    const linePrefixIndex = link.indexOf(linePrefix);
    const linkHasLineNumber = linePrefixIndex !== -1;
    const pathEndIndex = linkHasLineNumber ? linePrefixIndex : endOfLink;

    // Check if the file being referenced by the link is one of the modified files in the PR
    const filePath = link.substring(pathStartIndex, pathEndIndex);
    if (modifiedPRFiles.includes(filePath))
    {
      const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);

      UpdateModifiedFiles(
        fileName,
        linkHasLineNumber ? link.substring(0, linePrefixIndex) : link,
        learningPathFile);

      // This is the line number in the learning path file that contains the link - not the #L line number in the link itself
      const learningPathLineNumber = headLearningPathFileContentStr.substring(0, startOfLink).split("\n").length;

      // Get the contents of the referenced file from prev (old) and head (new) to compare them
      var headContent = ""
      try {
        headContent = fs.readFileSync(headPathPrefix + filePath, "utf8")
      }
      catch (error) {

        UpdateManuallyReview(
          fileName,
          link,
          learningPathFile,
          learningPathLineNumber);
        continue
      }

      if (!linkHasLineNumber) { continue }

      var prevContent = ""
      try {
        prevContent = fs.readFileSync(prevPathPrefix + filePath, "utf8")
      }
      catch (error) { continue }

      const linkLineNumber = Number(link.substring(linePrefixIndex + linePrefix.length, link.length));

      const headContentLines = headContent.toString().split("\n");
      const prevContentLines = prevContent.toString().split("\n");

      if (prevContent.length < linkLineNumber) // This shouldn't happen, unless the learning path is already out of date.
      {
        UpdateManuallyReview(
          fileName,
          link,
          learningPathFile,
          learningPathLineNumber,
          linkLineNumber);
      }
      // If the referenced line in the head branch is identical to the line in the head branch, then the line number is still considered correct.
      // Note that this can miss cases with ambiguous code that happens to align - this is a limitation of the heuristic. Learning Path authors
      // are encouraged to choose lines of code that are unique (e.g. not a newline, open brace, etc.)
      else if (headContentLines.length < linkLineNumber || prevContentLines[linkLineNumber - 1].trim() !== headContentLines[linkLineNumber - 1].trim())
      {
        // Check for multiple instances of the referenced line in the file - if there are multiple, then we don't know
        // which one to reference, so we'll ask the PR author to manually review the file.
        const lastIndex = headContentLines.lastIndexOf(prevContentLines[linkLineNumber - 1]) + 1;
        const firstIndex = headContentLines.indexOf(prevContentLines[linkLineNumber - 1]) + 1;

        if (lastIndex != firstIndex) // Indeterminate; multiple matches found in the file
        {
          UpdateManuallyReview(
            fileName,
            link,
            learningPathFile,
            learningPathLineNumber,
            linkLineNumber);
        }
        else
        {
          let oldLineNumber = linkLineNumber;
          let newLineNumber = firstIndex;

          let updatedLink = link.replace(oldHash, newHash);
          updatedLink = updatedLink.substring(0, linePrefixIndex) + linePrefix + newLineNumber;

          UpdateSuggestions(
            fileName,
            link,
            updatedLink,
            learningPathFile,
            learningPathLineNumber,
            oldLineNumber,
            newLineNumber)
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
    const changedFilePaths = core.getInput('changedFilePaths', {required: false});
    
    if (changedFilePaths === null || changedFilePaths.trim() === "") { return }

    // Scan each file in the learningPaths directory
    fs.readdir(headLearningPathsDirectory, (err, files) => {
      files.forEach(learningPathFile => {

        try {
          const headLearningPathFileContent = fs.readFileSync(headLearningPathsDirectory + "/" + learningPathFile, "utf8")
          if (headLearningPathFileContent)
          {
            CompareFiles(headLearningPathFileContent, repoURLToSearch, changedFilePaths.split(' '), learningPathFile)
          }
        } catch (error) {
          console.log("Error: " + error)
          console.log("Could not find learning path file: " + learningPathFile)
        }
      });
    });

  } catch (error) {
    core.setFailed(error.message);
  }
}

// Call the main function to run the action
main();