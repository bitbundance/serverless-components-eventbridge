const path = require('path')
const { generateId, getCredentials, getServerlessSdk, getEventbridge } = require('./utils')

// set enough timeout for deployment to finish
jest.setTimeout(30000)

// the yaml file we're testing against
const instanceYaml = {
  org: 'bitbundance',
  app: 'serverless-components',
  component: 'aws-eventbridge@dev',
  name: `aws-eventbridge-integration-tests-${generateId()}`,
  stage: 'dev',
  inputs: {} // should deploy with zero inputs
}

// we need to keep the initial instance state after first deployment
// to validate removal later
let firstInstanceState

// get aws credentials from env
const credentials = getCredentials()

// get serverless access key from env and construct sdk
const sdk = getServerlessSdk(instanceYaml.org)

// clean up the instance after tests
afterAll(async () => {
  await sdk.remove(instanceYaml, credentials)
})

it('should successfully deploy eventbus', async () => {
  const instance = await sdk.deploy(instanceYaml, credentials)

  // store the inital state for removal validation later on
  firstInstanceState = instance.state

  expect(instance.outputs.name).toBeDefined()
  expect(instance.outputs.arn).toBeDefined()
})

it('should successfully remove eventbridge', async () => {
  await sdk.remove(instanceYaml, credentials)

  // make sure lambda was actually removed
  let eventbus
  try {
    eventbus = await getEventbridge(credentials, firstInstanceState.name)
  } catch (e) {
    if (e.code !== 'ResourceNotFoundException') {
      throw e
    }
  }

  expect(eventbus).toBeUndefined()
})
