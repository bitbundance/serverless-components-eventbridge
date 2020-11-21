const path = require('path')
const { copySync } = require('fs-extra')
const { Component } = require('@serverless/core')
const {
  prepareInputs,
  getClients,
  createEventbus,
  updateLambdaFunctionCode,
  updateLambdaFunctionConfig,
  getEventbridge,
  createOrUpdateFunctionRole,
  createOrUpdateMetaRole,
  deleteEventbus,
  removeAllRoles,
  getMetrics
} = require('./utils')

class AwsEventbridge extends Component {
  /**
   * Deploy
   * @param {*} inputs
   */
  async deploy(inputs = {}) {
    // this error message assumes that the user is running via the CLI though...
    if (Object.keys(this.credentials.aws).length === 0) {
      const msg = `Credentials not found. Make sure you have a .env file in the cwd. - Docs: https://git.io/JvArp`
      throw new Error(msg)
    }

    // Check size of source code is less than 100MB
    if (this.size > 100000000) {
      throw new Error(
        'Your AWS Eventbridge source code size must be less than 100MB.'
      )
    }

    // Prepare inputs
    inputs = prepareInputs(inputs, this)

    console.log(
      `Starting deployment of AWS EventBridge "${inputs.name}" to the AWS region "${inputs.region}".`
    )

    // Get AWS clients
    const clients = getClients(this.credentials.aws, inputs.region)

    // Throw error on name change
    if (this.state.name && this.state.name !== inputs.name) {
      throw new Error(
        `Changing the name from ${this.state.name} to ${inputs.name} will delete the AWS Lambda function.  Please remove it manually, change the name, then re-deploy.`
      )
    }
    // Throw error on region change
    if (this.state.region && this.state.region !== inputs.region) {
      throw new Error(
        `Changing the region from ${this.state.region} to ${inputs.region} will delete the AWS Lambda function.  Please remove it manually, change the region, then re-deploy.`
      )
    }

    console.log(
      `Checking if an AWS Eventbridge has already been created with name: ${inputs.name}`
    )
    const prevEventBridge = await getEventbridge(clients.eventbridge, inputs.name)

    // Create or update Lambda function
    if (!prevEventBridge) {
      // Create a Lambda function
      console.log(
        `Creating a new AWS Eventbridge "${inputs.name}" in the "${inputs.region}" region.`
      )
      const createResult = await createEventbus(this, clients.eventbridge, inputs)
      inputs.arn = createResult.arn
      inputs.hash = createResult.hash
      console.log(`Successfully created an AWS EventBridge function`)
    } else {
      // Update a Lambda function
      inputs.arn = prevEventBridge.arn
      console.log(`Eventbridge ${inputs.name} already exists.`)
    }

    // Update state
    this.state.name = inputs.name
    this.state.arn = inputs.arn
    this.state.region = inputs.region

    return {
      name: inputs.name,
      arn: inputs.arn
    }
  }

  /**
   * Remove
   * @param {*} inputs
   */
  async remove(inputs = {}) {
    // this error message assumes that the user is running via the CLI though...
    if (Object.keys(this.credentials.aws).length === 0) {
      const msg = `Credentials not found. Make sure you have a .env file in the cwd. - Docs: https://git.io/JvArp`
      throw new Error(msg)
    }

    if (!this.state.name) {
      console.log(`No state found.  Function appears removed already.  Aborting.`)
      return
    }

    const clients = getClients(this.credentials.aws, this.state.region)

    console.log(`Removing AWS Eventbridge ${this.state.name} from the ${this.state.region} region.`)
    
    await deleteEventbus(clients.eventbridge, this.state.name)
    
    console.log(
      `Successfully removed Eventbridge ${this.state.name} from the ${this.state.region} region.`
    )

    this.state = {}
    return {clients}
  }

  /**
   * Metrics
   */
  async metrics(inputs = {}) {
    // Validate
    if (!inputs.rangeStart || !inputs.rangeEnd) {
      throw new Error('rangeStart and rangeEnd are require inputs')
    }

    const result = await getMetrics(
      this.state.region,
      this.state.metaRoleArn,
      this.state.name,
      inputs.rangeStart,
      inputs.rangeEnd
    )

    return result
  }
}

/**
 * Exports
 */
module.exports = AwsEventbridge
