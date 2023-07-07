// Flow
//
// On any PR change, scan each file in the learningPaths directory
// For each link in the file, check if the changed file is included in the PR's changes
// If so, check if the L## at the saved version of the file is the same as the L## at the current version of the file
// If it isn't, scan the file to see if the line is still there (if so, recommend changing the L## to the new L##)
// If the line can't be found, report back that the link should be manually reviewed for changes


const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');

var modifiedFiles = []; // output
var manuallyReview = []; // output

function UpdateModifiedFiles(path)
{
  modifiedFiles.push(path);
  core.setOutput('modifiedFiles', modifiedFiles.join("\n"));
}

function UpdateManuallyReview(path)
{
  manuallyReview.push(path);
  core.setOutput('manuallyReview', manuallyReview.join("\n"));
}

const main = async () => {

  try {
    const repoURLToSearch = core.getInput('repoURLToSearch', { required: true });
    const learningPathsDirectory = "merge/" + core.getInput('learningPathsDirectory', { required: true });
    const paths = core.getInput('paths', {required: false});

    console.log(process.cwd());
    console.log(learningPathsDirectory);

    const mergePathPrefix = "merge/";
    const headPathPrefix = "head/";
    
    var linksToCheck = [];
    var pathsToCheck = [];


    if (paths !== null && paths.trim() !== "")
    {
        pathsToCheck = paths.split(' ');
    }
    else
    {
      return;
    }

    // Scan each file in the learningPaths directory
    fs.readdir(learningPathsDirectory, (err, files) => {
      files.forEach(learningPathFile => {

        fs.readFile(learningPathsDirectory + "/" + learningPathFile, (err, learningPathFileContent) => {
          if (err) throw err;

          var learningPathFileContentStr = learningPathFileContent.toString();

          var indices = [];
          for(var pos = learningPathFileContentStr.indexOf(repoURLToSearch); pos !== -1; pos = learningPathFileContentStr.indexOf(repoURLToSearch, pos + 1)) {
              indices.push(pos);
          }

          // for each index, find next instance of ')' to get the end of the link
          for(var i = 0; i < indices.length; i++)
          {
            var index = indices[i];
            var endIndex = learningPathFileContentStr.indexOf(')', index);
            var link = learningPathFileContentStr.substring(index, endIndex);
            linksToCheck.push(link);
            //console.log("Link: " + link);

            const linePrefix = "#L";

            const indexOfLineNumber = link.indexOf("#L");
            const hasLineNumber = indexOfLineNumber !== -1;

            var lineNumber = "";

            if (hasLineNumber)
            {
              lineNumber = link.substring(indexOfLineNumber + linePrefix.length, link.length);
            }

            const pathStartIndex = link.indexOf("src");
            const pathEndIndex = hasLineNumber ? indexOfLineNumber : endIndex;

            const trimmedFilePath = link.substring(pathStartIndex, pathEndIndex);

            const pathIndex = pathsToCheck.indexOf(trimmedFilePath)
            console.log(trimmedFilePath);
            console.log(pathIndex);
            console.log("-----");

            if (pathIndex !== -1)
            {
              UpdateModifiedFiles(trimmedFilePath);

              if (hasLineNumber)
              {
                console.log("Has Line Number: " + lineNumber);

                var newContentLines = [];
                var existingContentLines = [];

                // not sure the best way to do this...might have to count newlines on merge and head
                // and then compare the lines.
                fs.readFile(mergePathPrefix + pathsToCheck[pathIndex], (err, newContent) => { // can probably also used trimmedFilePath here...depends how prefixes work
                  if (err || learningPathFileContentStr === null || learningPathFileContentStr.length === 0)
                  {
                    UpdateManuallyReview(trimmedFilePath);
                  }
                  else
                  {
                    var newContentStr = newContent.toString();

                    // file does exist, check line numbers
                    newContentLines = newContentStr.split("\n");

                    fs.readFile(headPathPrefix + pathsToCheck[pathIndex], (err, existingContent) => {
                    
                      if (err || existingContent === null || existingContent.length === 0)
                      {
                        console.log("This should never happen: " + err);
                        // this should never happen
                      }
                      else
                      {
                        console.log("Else: " + existingContent.toString());

                        var existingContentStr = existingContent.toString();

                        existingContentLines = existingContentStr.split("\n");

                        if (existingContentLines.length >= lineNumber && newContentLines.length >= lineNumber)
                        {
                          const lineNumberInt = Number(lineNumber) - 1;
                          console.log("Existing: " + existingContentLines[lineNumberInt].trim());
                          console.log("New: " + newContentLines[lineNumberInt].trim());
                          const equalLines = existingContentLines[lineNumberInt].trim() === newContentLines[lineNumberInt].trim()

                          if (!equalLines)
                          {
                            const updatedLineNumber = newContentLines.indexOf(existingContentLines[lineNumberInt]) + 1;

                            if (updatedLineNumber !== -1)
                            {
                              console.log("Updated line number: " + updatedLineNumber);

                              var updatedLearningPathFileContent = learningPathFileContentStr.substring(0, endIndex - lineNumber.length) + updatedLineNumber + learningPathFileContentStr.substring(endIndex, learningPathFileContentStr.length);

                              console.log("Before" + learningPathFileContentStr);
                              console.log("After" + updatedLearningPathFileContent);

                              fs.writeFile(learningPathsDirectory + "/" + learningPathFile, updatedLearningPathFileContent, (err) => {
                                if (err)
                                {
                                  console.log("Failed to write: " + err);
                                }
          
                              });

                            }
                            else
                            {
                              UpdateManuallyReview(trimmedFilePath);
                            }
                          }
                        }

                      }
                    });

                  }
                });

              }
              else
              {
                // just check that the file still exists
                fs.readFile(mergePathPrefix + pathsToCheck[pathIndex], (err, content) => {
                  if (err || content === null || content.length === 0)
                  {
                    UpdateManuallyReview(trimmedFilePath);
                  }
                  else
                  {
                    console.log("Content that we read: " + content.toString());
                  }
                });
  
              }


            }


            
          }

          //core.setOutput('modifiedFiles', modifiedFiles.join("\n"));
          //core.setOutput('manuallyReview', manuallyReview.join("\n"));
        });
      });

  
      //core.setOutput('modifiedFiles', modifiedFiles);
      //core.setOutput('manuallyReview', manuallyReview);
    });

  } catch (error) {
    core.setFailed(error.message);
  }
}

// Call the main function to run the action
main();
