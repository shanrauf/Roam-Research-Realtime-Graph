import { getGraph } from 'roam-client';
import {
  runExtension,
  getAttributeValueFromPage,
  getCurrentPageUid,
  extractTag,
} from './entry-helpers';

const extensionId = 'roam-graph';
const extensionPage = 'roam/js/roam-graph';
const graphName = getGraph();
const pullPattern =
  '[:node/title :block/children :block/string {:block/children ...}]';

// to render graph, you look at every one of these objects, create a node for it, and then repeat the function for all the Depends On values (unless already in cache or whatevs; and check for circular)
const graph: any = {
  uid1: {
    uid: 'uid1',
    string: 'Task 1',
    dependsOn: ['uid2'],
  },
  uid2: {
    uid: 'uid2',
    string: 'Task 2',
    dependsOn: ['uid3'],
  },
  uid3: {
    uid: 'uid3',
    string: 'Task 3',
    dependsOn: [],
  },
};

type Block = { string: string; uid: string; children: Block[] };
type GraphNode = { uid: string; string: string; dependsOn: string[] };
type GraphNodes = { [uid: string]: GraphNode };

function getBlockTree(blockUid: string): Block {
  let blocks: Block = window.roamAlphaAPI.q(
    `[
    :find (pull ?e [
        :block/uid
        :block/string 
        :block/children 
        {:block/children ...}
    ])
    :in $ ?startingblockuid
    :where [?e :block/uid ?startingblockuid]]`,
    blockUid
  )[0][0];

  return blocks;
}

// Can't for the life of me figure out how to do this without mutation
function getGraphNodes(blockUid: string, graphNodes: GraphNodes) {
  // Query for this block's info and its children info
  let blocks = getBlockTree(blockUid);

  // Find the Depends On block
  const dependsOnBlock = blocks.children
    ? blocks.children.filter((block) =>
        block.string.includes('Depends On::')
      )[0]
    : null;

  // Add this block to the dictionary
  graphNodes[blockUid] = {
    uid: blockUid,
    string: blocks.string,
    dependsOn:
      dependsOnBlock &&
      dependsOnBlock.children &&
      dependsOnBlock.children.every(
        (block) => block.string.startsWith('((') && block.string.endsWith('))') // DUPLICATE
      )
        ? dependsOnBlock.children.map((block) => block.string.slice(2, -2))
        : [],
  };

  if (dependsOnBlock && dependsOnBlock.children) {
    // For every child under this block, extract the uid from the block ref & check if that node is in the dictionary, and if not, recurse this function on it.
    dependsOnBlock.children.forEach((block) => {
      if (block.string.startsWith('((') && block.string.endsWith('))')) {
        // DUPLICATE
        console.log(block.string);
        const blockRefUid = block.string.slice(2, -2);
        if (!graphNodes.hasOwnProperty(blockRefUid)) {
          getGraphNodes(blockRefUid, graphNodes);
        }
      }
    });
  }

  return graphNodes;
}

function graphNodeToMermaid(graphNode: GraphNode) {
  const uid = graphNode.uid;
  const nodeStr = graphNode.string;
  const nodeLink = `https://roamresearch.com/#/app/${graphName}/page/${uid}`;
  const nodeLinkMermaid = `click ${uid} "${nodeLink}"`;
  console.log(nodeLinkMermaid);
  // If dependsOn > 1, use Depends On Node. Otherwise use Depends On edge label.
  const dependsOnNode = window.roamAlphaAPI.util.generateUID();
  let dependsOnNodes = '';
  const dependentNodes = graphNode.dependsOn.length;
  if (dependentNodes <= 0) {
    dependsOnNodes = '';
  } else if (dependentNodes <= 2) {
    dependsOnNodes = `\n    ${uid}-->|Depends On:|${graphNode.dependsOn.join(
      ' & '
    )}`;
  } else {
    dependsOnNodes = `\n    ${uid}-->${dependsOnNode}("Depends On:")-->${graphNode.dependsOn.join(
      ' & '
    )}`;
  }
  return `    ${uid}("${nodeStr}:")\n    ${nodeLinkMermaid}${dependsOnNodes}`;
}

function graphNodesToMermaid(graphNodes: GraphNodes) {
  let mermaidGraph = 'graph LR';
  for (const [nodeUid, node] of Object.entries(graphNodes)) {
    let mermaidMarkup = graphNodeToMermaid(node);
    mermaidGraph += '\n' + mermaidMarkup;
  }
  return mermaidGraph;
}

function renderBlockGraph(blockUid: string) {
  const graphNodes = getGraphNodes(blockUid, {});

  const mermaidGraphText = graphNodesToMermaid(graphNodes);

  // Create/find roam/js/roam-graph attribute on blockUid.
  const blockTree = getBlockTree(blockUid);
  const attributeBlock = blockTree.children.filter(
    (block) => block.string === `${extensionPage}::`
  )[0];

  let newAttributeBlockUid = window.roamAlphaAPI.util.generateUID();
  let mermaidBlockUid = window.roamAlphaAPI.util.generateUID();

  if (attributeBlock) {
    newAttributeBlockUid = attributeBlock.uid;
    // assuming mermaid block exists
    const mermaidBlock = attributeBlock.children.filter(
      (block) => block.string === '{{mermaid}}'
    )[0];
    mermaidBlockUid = mermaidBlock.uid;
    // delete mermaid block children.
    mermaidBlock.children.forEach((block) => {
      window.roamAlphaAPI.data.block.update({
        block: {
          uid: block.uid,
          string: mermaidGraphText,
          open: false,
        },
      });
    });
  } else {
    window.roamAlphaAPI.data.block.create({
      location: {
        'parent-uid': blockUid,
        order: 0,
      },
      block: {
        string: `${extensionPage}::`,
        uid: newAttributeBlockUid,
        open: false,
      },
    });
    window.roamAlphaAPI.data.block.create({
      location: {
        'parent-uid': newAttributeBlockUid,
        order: 0,
      },
      block: {
        string: '{{mermaid}}',
        uid: mermaidBlockUid,
        open: false,
      },
    });
    window.roamAlphaAPI.data.block.create({
      location: {
        'parent-uid': mermaidBlockUid,
        order: 0,
      },
      block: {
        string: mermaidGraphText,
        uid: window.roamAlphaAPI.util.generateUID(),
        open: false,
      },
    });
  }
  // doesnt work
  // window.roamAlphaAPI.ui.rightSidebar.removeWindow({
  //   window: {
  //     type: 'block',
  //     'block-uid': mermaidBlockUid,
  //   },
  // });

  // I'm just going to not add a window if there's something in the sidebar... hope it's the graph.
  if (!window.roamAlphaAPI.ui.rightSidebar.getWindows().length) {
    window.roamAlphaAPI.ui.rightSidebar.addWindow({
      window: {
        'block-uid': mermaidBlockUid,
        type: 'block',
      },
    });
  }
}

// TODO add a pull watch or whatever to update the mermaid gaph text when the block its based on changes (or the version of it or a child changes)
//// Uh... buut the tasks are distributed... so u have to add pull watches to every block in the graph even when not on that page???
// For now just right-click the block again to re-render.

runExtension(extensionId, () => {
  // Add block context menu button
  window.roamAlphaAPI.ui.blockContextMenu.addCommand({
    label: 'Open Graph in Sidebar',
    callback: (e) => {
      const blockUid = e['block-uid'];
      renderBlockGraph(blockUid);
    },
  });

  console.log(extensionId);
});
