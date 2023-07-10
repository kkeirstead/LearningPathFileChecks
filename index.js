// TODO:
// Report link to learning path that needs to be manually reviewed -> Done
// Don't just look for ) as end of link character
// Don't print this out every single time a change is made (or add a silencing mechanism)
// When a broken line has multiple possible matches, handle that scenario instead of just picking the first one

const core = require('@actions/core');
const fs = require('fs');

var modifiedFiles = new Set(); // output
var manuallyReview = new Set(); // output

function UpdateModifiedFiles(path, learningPathFile)
{
  modifiedFiles.add(path + " (in " + learningPathFile + ")");
  core.setOutput('modifiedFiles', Array.from(modifiedFiles).join(","));
}

function UpdateManuallyReview(path, learningPathFile)
{
  manuallyReview.add(path + " (in " + learningPathFile + ")");
  core.setOutput('manuallyReview', Array.from(manuallyReview).join(","));
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
              UpdateModifiedFiles(trimmedFilePath, learningPathFile);

              fs.readFile(mergePathPrefix + trimmedFilePath, (err, newContent) => {
                if (err || learningPathFileContentStr === null || learningPathFileContentStr.length === 0)
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
                        UpdateManuallyReview(trimmedFilePath, learningPathFile);
                      }
                      else if (existingContentLines[lineNumber - 1].trim() !== newContentLines[lineNumber - 1].trim())
                      {
                        const updatedLineNumber = newContentLines.indexOf(existingContentLines[lineNumber - 1]) + 1; // should check if there are multiple identical lines

                        if (updatedLineNumber === 0) // accounts for the +1 increment
                        {
                          UpdateManuallyReview(trimmedFilePath, learningPathFile);
                        }
                        else
                        {
                          const alternateLineNumber = newContentLines.indexOf(existingContentLines[lineNumber - 1], updatedLineNumber) + 1;

                          if (alternateLineNumber !== 0)
                          {
                            UpdateManuallyReview(trimmedFilePath, learningPathFile);
                          }
                          else
                          {
                            var updatedLearningPathFileContent = learningPathFileContentStr.substring(0, startIndex + pathEndIndex + linePrefix.length) + updatedLineNumber + learningPathFileContentStr.substring(endIndex, learningPathFileContentStr.length);

                            fs.writeFile(currLearningFilePath, updatedLearningPathFileContent, (err) => {
                              if (err)
                              {
                                console.log("Failed to write: " + err);
                              }
                            });
                          }
                        }
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
