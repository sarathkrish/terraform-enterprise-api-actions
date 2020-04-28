const core = require('@actions/core')
const axios = require('axios');
const fs = require('fs');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
var token;
var organizationName;
var workSpaceName;
var configFilePath;
var options;
var workSpaceId;
var configVersion;
var retryDuration = 1000;
var retryLimit = 3;
var terraformHost;
async function main() {
    try {
        token = core.getInput('terraformToken');
        organizationName = core.getInput('terraformOrg');
        workSpaceName = core.getInput('terraformWorkspace');
        configFilePath = core.getInput('configFilePath');
        terraformHost = core.getInput('terraformHost');
        console.log("organizationName:"+organizationName);
        console.log("workSpaceName:"+workSpaceName);
        console.log("configFilePath:"+configFilePath);
        console.log("terraformHost:"+terraformHost);

        options = {
            headers: {
                'Content-Type': 'application/vnd.api+json',
                'Authorization': 'Bearer ' + token
            }
        };


        // Step 1 - Create WorkSpace

        workSpaceId = await createWorkSpace();
        console.log("workSpaceId:"+workSpaceId);

        // Step 2 - Set Variables

        // Step 3 - Create Config Version

        configVersion = await createConfigVersion();
        console.log("configVersion:"+configVersion);
  

        // Step 4 - Upload Config

        await uploadConfiguration();

        // Step 5 - Attach Sentinel Policies

        // Step 6 - Run

        // Step 7 - Get Cost estimates

        // Step 8 - Optionally apply plan

    } catch (error) {
        core.setFailed(error.message);
    }
}

async function createWorkSpace() {
    try {
        //const terraformWorkSpaceEndpoint = "https://" + terraformHost + "/api/v2/organizations/" + organizationName + "/workspaces/" + workSpaceName;
        let request = { data : { attributes: { name : workSpaceName, type: "workspaces"}}};
        console.log("request:" + JSON.stringify(request));
        const terraformWorkSpaceEndpoint = "https://"+terraformHost+"/api/v2/organizations/"+organizationName+"/workspaces";
       
        console.log("terraformWorkSpaceEndpoint:"+terraformWorkSpaceEndpoint); 
        const response = await axios.post(terraformWorkSpaceEndpoint, request, options);
        const workSpaceId = response.data.data.id;
        console.log("workSpaceId:" + workSpaceId);
        return workSpaceId;
    } catch (err) {
        console.log(`Error creating workspace ${err}`)
        throw new Error(`Error creating workspace ${err.message}`)
    }
}

async function createConfigVersion(options) {
    try {

        const body = { data: { type: "configuration-versions", attributes: { "auto-queue-runs": false } } };
        const terraformConfigVersionsEndpoint = "https://" + terraformHost + "/api/v2/workspaces/" + workSpaceId + "/configuration-versions";
        console.log("terraformConfigVersionsEndpoint:"+terraformConfigVersionsEndpoint);
        res = await axios.post(terraformConfigVersionsEndpoint, body, options);
        const configVersion = res.data.data;
        console.log("create config version response:"+ res.data.data);
        return { id: configVersion.id, uploadUrl: configVersion.attributes['upload-url'] };

    } catch (err) {
        console.log(`Error in createConfigVersion ${err}`)
        throw new Error(`Error in createConfigVersion ${err.message}`)

    }

}

async function uploadConfiguration() {
    try {
        console.log("configVersion:"+configVersion);
        await axios.put(configVersion.uploadUrl, fs.createReadStream(configFilePath), { headers: { 'Content-Type': `application/octet-stream` } });
        var status = await getConfigVersionStatus(configVersion.id);
        var counter = 0;

        while (status === 'pending') {
            if (counter < retryLimit) {
                await sleep(retryDuration);
                status = await this.getConfigVersionStatus(configVersion.id);
                counter += 1;
            } else {
                throw new Error(`Config version status was still pending after ${retryLimit} attempts.`);
            }
        }

        if (status !== 'uploaded') {
            throw new Error(`Invalid config version status: ${JSON.stringify(status)}`);
        }

    } catch (err) {
        throw new Error(`Error uploading the configuration: ${err.message}`);
    }
}

async function getConfigVersionStatus(configVersionId) {
    try {
        const configVersionStatusUrl = "https://" + terraformHost + "/api/v2/workspaces/configuration-versions/"+configVersionId;
        console.log("configVersionStatusUrl:"+configVersionStatusUrl);
        const res = await axios.get(configVersionStatusUrl, options);
        console.log("configVersionStatus Response:"+res.data.data);
        return res.data.data.attributes.status;
    } catch (err) {
        throw new Error(`Error getting configuration version: ${err.message}`);
    }
}

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

main()
