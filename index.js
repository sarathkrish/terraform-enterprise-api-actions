const core = require('@actions/core')
const axios = require('axios');
const fs = require('fs');
const { ClientSecretCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");
// Setting SSL OFF // Need to remove this on prod
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
var terraformVariables;
var sentinelPolicySetId;
var runId;
var terraformEnvVariables;
var Client_Id ;
var Secret_Id ;
var Tenant_Id ;
var Subscription_Id ;
var pipelineConfigData;
var pipelineConfigFile;
var environment;
var pipelineConfigVariable;
var serviceNowEndPoint;
//var serviceNowEndPoint = "https://dev63722.service-now.com/api/482432/tfe_notification_listener";


async function main() {
    try {
        // Global variables
        token = core.getInput('terraformToken');
        organizationName = core.getInput('terraformOrg');
        workSpaceName = core.getInput('terraformWorkspace');
        configFilePath = core.getInput('configFilePath');
        terraformHost = core.getInput('terraformHost');
        sentinelPolicySetId = core.getInput('sentinelPolicySetId');
        Client_Id = core.getInput('Client_Id');
        Secret_Id = core.getInput('Secret_Id');
        Tenant_Id = core.getInput('Tenant_Id');
        Subscription_Id = core.getInput('Subscription_Id');
        pipelineConfigFile = core.getInput('pipelineConfigFile');
        environment = core.getInput('environment');
        terraformVariables = JSON.parse(core.getInput('terraformVariables'));
        //let pipelineConfigDataString = fs.readFileSync(pipelineConfigFile);
        pipelineConfigData = JSON.parse(fs.readFileSync(pipelineConfigFile));   
        pipelineConfigVariable=pipelineConfigData.parameterMappings[environment];
        serviceNowEndPoint = core.getInput('serviceNowUrl');
        

        // Log Input Variables
        console.log("**************Input*********************");
        console.log("organizationName:"+organizationName);
        console.log("workSpaceName:"+workSpaceName);
        console.log("configFilePath:"+configFilePath);
        console.log("terraformHost:"+terraformHost);
        console.log("terraformVariables:"+terraformVariables);
        console.log("terraformEnvVariables:"+terraformEnvVariables);
        console.log("sentinelPolicySetId:"+sentinelPolicySetId);
        console.log("pipelineConfigFile:"+pipelineConfigFile);
        console.log("environment:"+environment);
        console.log("pipelineConfigData:"+JSON.stringify(pipelineConfigData));
        console.log("Parameters:"+JSON.stringify(pipelineConfigData.parameterMappings[environment]));
        console.log("serviceNowEndPoint:"+serviceNowEndPoint);
        console.log("**************Input*********************");

        // Azure Credentials as env params

        envVariables =  [{"key":"ARM_CLIENT_ID","value":Client_Id,"category":"env","hcl":false,"sensitive":true},
                        {"key":"ARM_CLIENT_SECRET","value":Secret_Id,"category":"env","hcl":false,"sensitive":true},
                        {"key":"ARM_TENANT_ID","value":Tenant_Id,"category":"env","hcl":false,"sensitive":true},
                        {"key":"ARM_SUBSCRIPTION_ID","value":Subscription_Id,"category":"env","hcl":false,"sensitive":true}
                     ];

        // Terraform Request Header 
        options = {
            headers: {
                'Content-Type': 'application/vnd.api+json',
                'Authorization': 'Bearer ' + token
            }
        };
  

        // Step 1 - Create WorkSpace

        workSpaceId = await createWorkSpace();

        // Step 2 - Set Variables

          await setVariables(terraformVariables);

        // Step 2.1 - Set Environment Variable

         await setVariables(envVariables);

        // Step 2.2 - Set Config Variable
          await setVariables(pipelineConfigVariable, true);

        // Step 3 - Create Config Version

         configVersion = await createConfigVersion();
  
        // Step 4 - Upload Config

         await uploadConfiguration();

        // Step 5 - Attach Sentinel Policies

         await attachSentinelPolicySet();

        // Step 6 - Run

         runId = await run();

        // Step 7 - Check status and Update ServiceNow
        
         await sendFeedback();

    } catch (error) {
        // Log Incident 
        let sericeNowMessage = buildServiceNowFailureResponse("GitHub Pipeline Execution Failed:"+error.message);
        invokeServiceNowScriptedRestAPI(sericeNowMessage);
        core.setFailed(error.message);
    }
}

async function createWorkSpace() {
    try {
        let request = { data : { attributes: { name : workSpaceName, type: "workspaces" , "auto-apply" : false}}};
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

async function setVariables(terraformVariables, isConfigVarible) {
  try{
    const terraformVariableEndpoint = "https://" + terraformHost + "/api/v2/workspaces/" + workSpaceId + "/vars";  
    for(var i=0; i < terraformVariables.length; i++ ){
        let var2Process = terraformVariables[i]; 
        console.log("attribute:"+JSON.stringify(var2Process));

        if(isConfigVarible){
            var2Process = await processVariable(var2Process);
        }
        console.log("attribute:"+JSON.stringify(var2Process));
        var req = {data: {type: "vars", attributes: var2Process }};
        console.log("Request:"+ JSON.stringify(req));
        // Invoke 
        const response = await axios.post(terraformVariableEndpoint, req, options);
        console.log("Set Variable Response:"+ JSON.stringify(response.data));
      }


  }catch(err){
    console.log(`Error setting variables${err}`)
    throw new Error(`Error setting variables ${err.message}`)
  }
}

async function createConfigVersion() {
    try {

        const body = { data: { type: "configuration-versions", attributes: { "auto-queue-runs": false } } };
        const terraformConfigVersionsEndpoint = "https://" + terraformHost + "/api/v2/workspaces/" + workSpaceId + "/configuration-versions";
        console.log("terraformConfigVersionsEndpoint:"+terraformConfigVersionsEndpoint);
        console.log("terraformConfigVersions request:"+JSON.stringify(body));
        res = await axios.post(terraformConfigVersionsEndpoint, JSON.stringify(body), options);
        const configVersion = res.data.data;
        console.log("create config version response:"+ JSON.stringify(res.data.data));
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
                status = await getConfigVersionStatus(configVersion.id);
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
        const configVersionStatusUrl = "https://" + terraformHost + "/api/v2/configuration-versions/"+configVersionId;
        console.log("configVersionStatusUrl:"+configVersionStatusUrl);
        const res = await axios.get(configVersionStatusUrl, options);
        console.log("configVersionStatus Response:"+res.data.data);
        return res.data.data.attributes.status;
    } catch (err) {
        console.log("Error in getConfigVersionStatus:"+err.message);
        throw new Error(`Error getting configuration version: ${err.message}`);
    }
}

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function attachSentinelPolicySet(){
    try{
        const attachPolicyUrl = "https://" + terraformHost + "/api/v2/policy-sets/"+sentinelPolicySetId+"/relationships/workspaces";
        let req = { data : [ {id: workSpaceId, type: "workspaces" }]};
        console.log("attachSentinelPolicySet req:"+JSON.stringify(req));
        const res = await axios.post(attachPolicyUrl, req,  options);
        console.log("attachSentinelPolicySet:"+res.data.data);
    }catch(err){
        console.log("Error in attachPolicySet:"+err.message);
        throw new Error(`Error Attaching Policy Set ${err.message}`);
    }
}

async function run(){
 try{
    const terraformRunEndpoint = "https://"+terraformHost+"/api/v2/runs";
    let request = { data : { 
                    attributes: { "is-destroy" : false, "message" : "Pipeline invocation" },
                    type: "runs",
                    relationships: {
                      workspace: {
                        data: {
                          type: "workspaces",
                          id: workSpaceId
                        }
                      }
                    }
                   }};
    console.log("run request:" + JSON.stringify(request));
    const res = await axios.post(terraformRunEndpoint, request,  options);
    console.log("run response:"+res.data.data);
    const runId = res.data.data.id;
     return runId;
    }catch(err){
        console.log("Error in run:"+err.message);
        throw new Error(`Error in run ${err.message}`);
    }
}

async function sendFeedback(){
    var checkStatus = true;

  do{
    await sleep(60000);
    const status = await checkRunStatus(runId);

   if("errored" == status){
        checkStatus = false;
        console.log("Plan execution failed");
        // Send Failed Response
        let sericeNowMessage = buildServiceNowFailureResponse("Plan Execution Failed in TFE");
        invokeServiceNowScriptedRestAPI(sericeNowMessage);
   }
   else if("discarded" == status) {
        checkStatus = false;
        console.log("Plan execution discarded manually");
        // Send Failed Response
        let sericeNowMessage = buildServiceNowFailureResponse("Plan Execution discarded in TFE");
        invokeServiceNowScriptedRestAPI(sericeNowMessage);
   }
   else if("policy_override" == status){
        checkStatus = false;
        console.log("Sentinel policy failed");
        // Send Failed Response
        let sericeNowMessage = buildServiceNowFailureResponse("Sentinel Policy Failed");
        invokeServiceNowScriptedRestAPI(sericeNowMessage);
    }
    else if("policy_checked" == status){
        checkStatus = false;
        console.log("Sentinel policy passed, ready to apply");
        // Apply Plan  
        await applyPlan();
    }
    else if("finished" == status || "applied" == status) {
        checkStatus = false;
        console.log("Plan execution completed successfully");
        // Send Success Response
        let outputs = getOutputs();
        console.log("TFE outputs:"+outputs);
        let sericeNowMessage = buildServiceNowSuccessResponse(outputs);
        console.log("sericeNowMessage:"+sericeNowMessage);
        invokeServiceNowScriptedRestAPI(sericeNowMessage);

    }

    

  }while(checkStatus);

}

async function checkRunStatus(){

    try{
        const terraformRunStatusEndpoint = "https://"+terraformHost+"/api/v2/runs/"+runId;
        console.log("terraformRunStatusEndpoint:"+terraformRunStatusEndpoint);
        const res = await axios.get(terraformRunStatusEndpoint, options);
        console.log("run response:"+JSON.stringify(res.data.data));
        return res.data.data.attributes.status;
    }
    catch(err){
        console.log("Error in checking run status:"+err.message);
        throw new Error(`Error in checking run status${err.message}`);
    }

}

async function applyPlan() {
    try{
        const terraformApplyPlanEndpoint = "https://"+terraformHost+"/api/v2/runs/"+runId+"/actions/apply";
        console.log("terraformApplyPlanEndpoint:"+terraformApplyPlanEndpoint);
        var data = { "comment":"Pipeline apply"}
        const res = await axios.post(terraformApplyPlanEndpoint, data,options);
        console.log("run response:"+JSON.stringify(res.data));
        await sendFeedback();
    }
    catch(err){
        console.log("Error in applying plan:"+err.message);
        throw new Error(`Error in applying plan${err.message}`);
    }

}

async function getSecretFromAzureKeyVault(url, secretName){
    try{
        const credential =  new ClientSecretCredential(Tenant_Id, Client_Id, Secret_Id);
        const client = new SecretClient(url, credential);
        const latestSecret = await client.getSecret(secretName);
        console.log("latestSecret:"+latestSecret);
        return latestSecret.value;
    }
    catch(err){
        console.log("Error in getSecretFromAzureKeyVault:"+err.message);
        throw new Error(`Error in getSecretFromAzureKeyVault${err.message}`);
    }
}

async function processVariable(variable){
    try{
        let returnVariable ;
        if(variable.action && 'KeyVaultSecret' === variable.action){
            let value = await getSecretFromAzureKeyVault(variable.vaultUrl, variable.secretName);
              returnVariable = {
                "key": variable.key,
                "value" : value,
                "category":variable.category,
                "hcl":variable.hcl,
                "sensitive":true
            };
            console.log("processVariable:"+JSON.stringify(returnVariable));
            return returnVariable;
        }
        else if(variable.action && 'None' === variable.action) {

               returnVariable = {
                "key": variable.key,
                "value" : variable.value,
                "category":variable.category,
                "hcl": variable.hcl,
                "sensitive":variable.sensitive
            };
            console.log("processVariable:"+JSON.stringify(returnVariable));
            return returnVariable;
        }
        else {
            return variable;
        }
    }
    catch(err){
        console.log("Error in processVariable:"+err.message);
        throw new Error(`Error in processVariable${err.message}`);
    }
}

async function getOutputs() {
    try {
        const stateVersionEndpoint = "https://"+terraformHost+"/api/v2/workspaces/"+workSpaceId+"/current-state-version";
        console.log("stateVersionEndpoint:"+stateVersionEndpoint);
        let terraformOutPuts = [];
        const verResponse = await axios.get(stateVersionEndpoint,options);
        for(  i = 0; i < verResponse.data.data.relationships.outputs.data.length; i++){
            let stateId = verResponse.data.data.relationships.outputs.data[i].id;
            let outputsEndpoint = "https://"+terraformHost+"/api/v2/state-version-outputs/"+stateId;
            let res = await axios.get(outputsEndpoint,options);
            var output = { "name": res.data.data.attributes.name, "value": res.data.data.attributes.value};
            terraformOutPuts.push(output);
        }
        return terraformOutPuts;
    }catch(err){
        console.log("Error in getOutputs:"+err.message);
        throw new Error(`Error in getOutputs${err.message}`);
    }
}


async function buildServiceNowSuccessResponse(outputs){

    let response =  {
           "TaskId": workSpaceName,
           "TFEResponse":{
           "TFEWorkspaceId":workSpaceId,
           "TFEWorkspaceName":workSpaceName,
           "TFEOutputs": outputs  
          },
          "Message":"Success"       
   }
   return response;
}

async function buildServiceNowFailureResponse(reason){

    let response =  {
           "TaskId": workSpaceName,
           "TFEResponse":{
           "TFEWorkspaceId":workSpaceId,
           "TFEWorkspaceName":workSpaceName,
           "Reason": reason
          },
          "Message":"Failed"       
   }
   return response;
}

async function invokeServiceNowScriptedRestAPI(data){
    try{
    let res = await axios.post(serviceNowEndPoint,data);
    console.log("service Now response:"+JSON.stringify(res.data));
    }catch(err){
        console.log("Error in invokeServiceNowScriptedRestAPI:"+err.message);
        throw new Error(`Error in invokeServiceNowScriptedRestAPI${err.message}`);
    }

}


main();
