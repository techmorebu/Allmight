Here’s the README file for the Universal Field Mapper:


---

README for Universal Field Mapper
q you lol lll
llll
File: scripts/universal-field-mapper.js


---

Purpose

The Universal Field Mapper dynamically queries APIs (GraphQL or REST) to extract schema and field data, storing the results as JSON files. This tool helps:

1. Understand the data structure and capabilities of each API.


2. Identify relevant fields for the project.


3. Build a database of API schemas for future reference.




---

Functionality

The Universal Field Mapper:

1. Loads API URLs:

Reads API endpoints from the .env file (e.g., UNISWAP_DEX_API).



2. Queries APIs:

For GraphQL APIs, sends an introspection query to fetch schema details.

For REST APIs, uses predefined endpoints to fetch metadata or structure.



3. Processes Schema:

Extracts field names, types (e.g., SCALAR, OBJECT), and metadata.



4. Saves Outputs:

Writes schema data to JSON files in the ./outputs directory.





---

Setup Instructions

1. Install Dependencies

Install the required Node.js libraries:

npm install node-fetch dotenv


---

2. Set Up the .env File

Add your API endpoints to the .env file:

UNISWAP_DEX_API=https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3
CURVE_DEX_API=https://api.curve.fi/api/getPools/ethereum
SUSHISWAP_DEX_API=https://api.thegraph.com/subgraphs/name/sushiswap/exchange


---

3. Run the Script

Execute the script from the project root:

node scripts/universal-field-mapper.js


---

Outputs

Schema files are saved in the ./outputs directory.

File format: <api_name>-fields-<date>.json.


Example:

outputs/
├── uniswap-fields-2025-01-04.json
├── curve-fields-2025-01-04.json
├── sushiswap-fields-2025-01-04.json


---

How It Works

1. Querying APIs

GraphQL APIs:

Sends an introspection query to retrieve schema details:

{
  __schema {
    types {
      name
      kind
      fields {
        name
        type {
          name
          kind
          ofType {
            name
            kind
          }
        }
      }
    }
  }
}


REST APIs:

Sends a basic GET request to fetch metadata.



2. Processing Schema

The script parses the API response to extract:

Field Name: Name of the field (e.g., volumeUSD).

Field Type: Data type (e.g., Float, String).

Kind: Field structure (e.g., SCALAR, OBJECT, LIST).


Example Output:

[
  {
    "name": "volumeUSD",
    "type": "Float",
    "kind": "SCALAR"
  },
  {
    "name": "liquidity",
    "type": "Float",
    "kind": "SCALAR"
  }
]


---

Use Cases

1. API Field Analysis:

Understand available fields and their data types.

Plan fetcher logic based on schema details.



2. Field Matching:

Compare available fields with project-required fields using the cross-referencing script.



3. Schema Storage:

Maintain a database of API schemas for historical reference and debugging.





---

Troubleshooting

1. Script Errors

Error: "Failed to fetch schema for [API]."

Cause: Incorrect API URL or network issue.

Fix: Verify the API URL in the .env file.


Error: "API Error: [message]."

Cause: API returned an error.

Fix: Check API documentation or test the endpoint manually using Postman.




---

Future Enhancements

1. REST API Schema Support:

Add logic to handle REST APIs that lack metadata endpoints.



2. Advanced Schema Analysis:

Include relationship mappings and nested fields.



3. Automation:

Schedule periodic schema updates for dynamic APIs.


