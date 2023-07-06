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

const main = async () => {
  try {
    const repoURLToSearch = core.getInput('repoURLToSearch', { required: true });
    const learningPathsDirectory = "merge/" + core.getInput('learningPathsDirectory', { required: true });
    const paths = core.getInput('paths', {required: false});

    console.log(process.cwd());
    console.log(learningPathsDirectory);

    const insertFileNameParameter = "{insertFileName}";

    const mergePathPrefix = "merge/";
    const headPathPrefix = "head/";

    var linksToCheck = [];
    var pathsToCheck = [];

    var modifiedFiles = []; // output
    var manuallyReview = []; // output

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

        fs.readFile(mergePathPrefix + learningPathFile, (err, learningPathFileContent) => {
          if (err) throw err;


          var indices = [];
          for(var pos = learningPathFileContent.indexOf(repoURLToSearch); pos !== -1; pos = learningPathFileContent.indexOf(repoURLToSearch, pos + 1)) {
              indices.push(pos);
          }

          // for each index, find next instance of ')' to get the end of the link
          for(var i = 0; i < indices.length; i++)
          {
            var index = indices[i];
            var endIndex = learningPathFileContent.indexOf(')', index) - 1;
            var link = learningPathFileContent.substring(index, endIndex);
            linksToCheck.push(link);
            console.log(link);

            const linePrefix = "#L";

            const indexOfLineNumber = link.indexOf("#L");
            const hasLineNumber = indexOfLineNumber !== -1;

            var lineNumber = "";

            if (hasLineNumber)
            {
              lineNumber = link.substring(indexOfLineNumber + linePrefix.length, link.length);
              console.log(lineNumber);
            }

            const pathStartIndex = link.indexOf("src");
            const pathEndIndex = hasLineNumber ? indexOfLineNumber - 1 : endIndex;

            const trimmedFilePath = link.substring(pathStartIndex, pathEndIndex);

            const pathIndex = pathsToCheck.indexOf(trimmedFilePath)

            if (pathIndex !== -1)
            {
              modifiedFiles.push(pathsToCheck); // push everything that's modified onto this list

              if (hasLineNumber)
              {

                var newContentLines = [];
                var existingContentLines = [];

                // not sure the best way to do this...might have to count newlines on merge and head
                // and then compare the lines.
                fs.readFile(mergePathPrefix + pathsToCheck[pathIndex], (err, newContent) => { // can probably also used trimmedFilePath here...depends how prefixes work
                  if (err || learningPathFileContent === null || learningPathFileContent.length === 0)
                  {
                    // file no longer exists
                    // recommend that the link be manually reviewed
                    deletedFiles.push(trimmedFilePath)
                  }
                  else
                  {
                    // file does exist, check line numbers
                    newContentLines = newContent.split("\n");

                    fs.readFile(headPathPrefix + trimmedFilePath, (err, existingContent) => {
                    
                      if (err || existingContent === null || existingContent.length === 0)
                      {
                        // this should never happen
                      }
                      else
                      {
                        existingContentLines = existingContent.split("\n");

                        if (existingContentLines.length >= lineNumber && newContentLines.length >= lineNumber)
                        {
                          const lineNumberInt = Number(lineNumber) - 1;
                          const equalLines = existingContentLines[lineNumberInt].trim() === newContentLines[lineNumberInt].trim()

                          if (!equalLines)
                          {
                            const updatedLineNumber = newContentLines.indexOf(existingContentLines[lineNumberInt]);

                            if (updatedLineNumber !== -1)
                            {
                              var updatedLearningPathFileContent = learningPathFileContent.substr(0, indexOfLineNumber + linePrefix.length) + updatedLineNumber + learningPathFileContent.substr(endIndex + 1, learningPathFileContent.length);

                              fs.writeFile(mergePathPrefix + learningPathFile, updatedLearningPathFileContent, (err) => {

                              });

                            }
                            else
                            {
                              // recommend that the link be manually reviewed
                              manuallyReview.push(trimmedFilePath)
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
                    // file no longer exists
                    // recommend that the link be manually reviewed
                    deletedFiles.push(trimmedFilePath)
                  }
                });
  
              }


            }


            
          }
          

          console.log(learningPathFile);
        });
      });
    });
    

    core.setOutput('modifiedFiles', modifiedFiles);
    core.setOutput('manuallyReview', manuallyReview);

  } catch (error) {
    core.setFailed(error.message);
  }
}

// Call the main function to run the action
main();
