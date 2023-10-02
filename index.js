const core = require('@actions/core');
const fs = require('fs');

var modifiedFiles = []; // output
var manuallyReview = []; // output

function UpdateModifiedFiles(path)
{
  modifiedFiles.push(path);
  core.setOutput('modifiedFiles', modifiedFiles.join(","));
}

function UpdateManuallyReview(path)
{
  manuallyReview.push(path);
  core.setOutput('manuallyReview', manuallyReview.join(","));
}

const main = async () => {

  try {
    const repoURLToSearch = core.getInput('repoURLToSearch', { required: true });
    const learningPathsDirectory = "merge/" + core.getInput('learningPathsDirectory', { required: true });
    const paths = core.getInput('paths', {required: false});

    const mergePathPrefix = "merge/";
    const headPathPrefix = "head/";
    const linePrefix = "#L";
    
    if (paths === null && paths.trim() === "")
    {
      return;
    }

    var modifiedFilePaths = paths.split(' ');

    // Scan each file in the learningPaths directory
    fs.readdir(learningPathsDirectory, (err, files) => {
      files.forEach(learningPathFile => {

        const currLearningFilePath = learningPathsDirectory + "/" + learningPathFile

        fs.readFile(currLearningFilePath, (err, learningPathFileContent) => {
          if (err) throw err;

          var learningPathFileContentStr = learningPathFileContent.toString();

          var linkIndices = [];
          for(var pos = learningPathFileContentStr.indexOf(repoURLToSearch); pos !== -1; pos = learningPathFileContentStr.indexOf(repoURLToSearch, pos + 1)) {
              linkIndices.push(pos);
          }

          for(let startIndex of linkIndices)
          {
            const endIndex = learningPathFileContentStr.indexOf(')', startIndex); // should also check for any character that can't be in url
            const link = learningPathFileContentStr.substring(startIndex, endIndex);

            const indexOfLineNumber = link.indexOf(linePrefix);
            const hasLineNumber = indexOfLineNumber !== -1;

            const pathStartIndex = link.indexOf("src"); // should just trim the prefix, since this might not always be the case?
            const pathEndIndex = hasLineNumber ? indexOfLineNumber : endIndex;

            const trimmedFilePath = link.substring(pathStartIndex, pathEndIndex);

            const pathIndex = modifiedFilePaths.indexOf(trimmedFilePath)

            if (pathIndex !== -1)
            {
              UpdateModifiedFiles(trimmedFilePath);

              fs.readFile(mergePathPrefix + trimmedFilePath, (err, newContent) => {
                if (err || learningPathFileContentStr === null || learningPathFileContentStr.length === 0)
                {
                  UpdateManuallyReview(trimmedFilePath);
                }
                else if (hasLineNumber)
                {
                  fs.readFile(headPathPrefix + trimmedFilePath, (err, existingContent) => {
                  
                    // If the file previously didn't exist, then we don't need to check line numbers
                    if (err || existingContent === null || existingContent.length === 0) return; // not sure this is okay
                    else
                    {
                      const lineNumber = Number(link.substring(indexOfLineNumber + linePrefix.length, link.length));

                      const newContentLines = newContent.toString().split("\n");
                      const existingContentLines = existingContent.toString().split("\n");

                      if (existingContentLines.length < lineNumber || newContentLines.length < lineNumber)
                      {
                        UpdateManuallyReview(trimmedFilePath);
                        return;
                      }

                      if (existingContentLines[lineNumber - 1].trim() !== newContentLines[lineNumber - 1].trim())
                      {
                        const updatedLineNumber = newContentLines.indexOf(existingContentLines[lineNumber - 1]) + 1; // should check if there are multiple identical lines

                        if (updatedLineNumber === -1)
                        {
                          UpdateManuallyReview(trimmedFilePath);
                          return;
                        }
                        
                        var updatedLearningPathFileContent = learningPathFileContentStr.substring(0, startIndex + pathEndIndex + linePrefix.length) + updatedLineNumber + learningPathFileContentStr.substring(endIndex, learningPathFileContentStr.length);

                        fs.writeFile(currLearningFilePath, updatedLearningPathFileContent, (err) => {
                          if (err)
                          {
                            console.log("Failed to write: " + err);
                          }
                        });
                      }                      
                    }
                  });
                }
              });
            }
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